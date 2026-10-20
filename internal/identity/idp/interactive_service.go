package idp

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"project_alpha/internal/identity/oauth"
	"project_alpha/internal/identity/principal"
)

const (
	SessionCookieName = "gateway_idp_session"
	sessionMaxAge     = 8 * time.Hour
)

var (
	ErrSessionExpired       = errors.New("idp session expired")
	ErrInvalidSessionCookie = errors.New("invalid or tampered session cookie")
)

// InteractiveService provides user login, consent management, and OAuth authorization.
type InteractiveService struct {
	userRepo      UserRepository
	consentRepo   *oauth.SQLAuthorizationService
	signingSecret []byte
}

// NewInteractiveService creates a new interactive authentication and consent service.
func NewInteractiveService(userRepo UserRepository, consentRepo *oauth.SQLAuthorizationService, signingSecret []byte) (*InteractiveService, error) {
	if userRepo == nil {
		return nil, errors.New("user repository cannot be nil")
	}
	if consentRepo == nil {
		return nil, errors.New("consent repository cannot be nil")
	}
	if len(signingSecret) < 32 {
		return nil, errors.New("signing secret must contain at least 32 bytes")
	}
	return &InteractiveService{
		userRepo:      userRepo,
		consentRepo:   consentRepo,
		signingSecret: append([]byte(nil), signingSecret...),
	}, nil
}

// Authorize implements oauth.AuthorizationService.
func (s *InteractiveService) Authorize(ctx context.Context, r *http.Request, client *oauth.Client, requestedScopes []string) (oauth.AuthorizationDecision, error) {
	if client == nil {
		return oauth.AuthorizationDecision{}, errors.New("oauth client cannot be nil")
	}

	// 1. Identify user from request context (bearer token) or session cookie
	var tenantID, userID string
	if p, ok := principal.FromContext(ctx); ok && p.Subject != "" {
		tenantID = p.TenantID
		userID = p.Subject
	} else if r != nil {
		sessionUser, err := s.getAuthenticatedUserFromCookie(ctx, r)
		if err == nil && sessionUser != nil {
			tenantID = sessionUser.TenantID
			userID = sessionUser.ID
		}
	}

	if userID == "" || tenantID == "" {
		return oauth.AuthorizationDecision{}, oauth.ErrAuthenticatedPrincipalRequired
	}
	if tenantID != client.TenantID {
		return oauth.AuthorizationDecision{}, oauth.ErrConsentTenantMismatch
	}

	// 2. Delegate to SQL consent check
	fakePrincipalCtx := principal.WithContext(ctx, principal.Principal{
		Subject:  userID,
		TenantID: tenantID,
	})
	return s.consentRepo.Authorize(fakePrincipalCtx, r, client, requestedScopes)
}

// HandleLogin processes interactive user login.
func (s *InteractiveService) HandleLogin(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		returnTo := r.URL.Query().Get("return_to")
		tenantID := r.URL.Query().Get("tenant_id")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head><title>Sign In - AI Gateway</title></head>
<body>
<h2>AI Gateway Identity Provider</h2>
<form method="POST" action="/login">
  <input type="hidden" name="return_to" value="%s"/>
  <label>Tenant ID: <input type="text" name="tenant_id" value="%s" required/></label><br/><br/>
  <label>Username: <input type="text" name="username" required/></label><br/><br/>
  <label>Password: <input type="password" name="password" required/></label><br/><br/>
  <button type="submit">Sign In</button>
</form>
</body>
</html>`, templateEscape(returnTo), templateEscape(tenantID))

	case http.MethodPost:
		if err := r.ParseForm(); err != nil {
			http.Error(w, "invalid form data", http.StatusBadRequest)
			return
		}
		tenantID := strings.TrimSpace(r.FormValue("tenant_id"))
		username := strings.TrimSpace(r.FormValue("username"))
		password := r.FormValue("password")
		returnTo := r.FormValue("return_to")

		user, err := s.userRepo.Authenticate(r.Context(), tenantID, username, password)
		if err != nil {
			if strings.Contains(r.Header.Get("Accept"), "application/json") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid credentials"})
				return
			}
			http.Error(w, "invalid username or password", http.StatusUnauthorized)
			return
		}

		// Create and set signed session cookie
		cookieVal := s.createSessionToken(user.TenantID, user.ID)
		http.SetCookie(w, &http.Cookie{
			Name:     SessionCookieName,
			Value:    cookieVal,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   int(sessionMaxAge.Seconds()),
		})

		if returnTo != "" && validRedirectURL(returnTo) {
			http.Redirect(w, r, returnTo, http.StatusSeeOther)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":    "authenticated",
			"user_id":   user.ID,
			"username":  user.Username,
			"tenant_id": user.TenantID,
			"roles":     user.Roles,
		})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleConsent processes interactive OAuth consent approval.
func (s *InteractiveService) HandleConsent(w http.ResponseWriter, r *http.Request) {
	user, err := s.getAuthenticatedUserFromCookie(r.Context(), r)
	if err != nil || user == nil {
		loginURL := "/login?return_to=" + url.QueryEscape(r.URL.RequestURI())
		http.Redirect(w, r, loginURL, http.StatusSeeOther)
		return
	}

	switch r.Method {
	case http.MethodGet:
		clientID := r.URL.Query().Get("client_id")
		scopes := r.URL.Query().Get("scope")
		returnTo := r.URL.Query().Get("return_to")

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head><title>Authorize Application - AI Gateway</title></head>
<body>
<h2>Consent Request</h2>
<p>Application <strong>%s</strong> requests access to your resources in tenant <strong>%s</strong>.</p>
<p>Requested Scopes: <code>%s</code></p>
<form method="POST" action="/consent">
  <input type="hidden" name="client_id" value="%s"/>
  <input type="hidden" name="scope" value="%s"/>
  <input type="hidden" name="return_to" value="%s"/>
  <button type="submit" name="decision" value="approve">Authorize</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>
</body>
</html>`, templateEscape(clientID), templateEscape(user.TenantID), templateEscape(scopes),
			templateEscape(clientID), templateEscape(scopes), templateEscape(returnTo))

	case http.MethodPost:
		if err := r.ParseForm(); err != nil {
			http.Error(w, "invalid form", http.StatusBadRequest)
			return
		}
		decision := r.FormValue("decision")
		clientID := strings.TrimSpace(r.FormValue("client_id"))
		scopesRaw := strings.Fields(r.FormValue("scope"))
		returnTo := r.FormValue("return_to")

		if decision != "approve" {
			http.Error(w, "access denied by user", http.StatusForbidden)
			return
		}

		if err := s.consentRepo.GrantConsent(r.Context(), user.TenantID, user.ID, clientID, scopesRaw); err != nil {
			http.Error(w, "failed recording consent: "+err.Error(), http.StatusInternalServerError)
			return
		}

		if returnTo != "" && validRedirectURL(returnTo) {
			http.Redirect(w, r, returnTo, http.StatusSeeOther)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "consent_granted"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *InteractiveService) createSessionToken(tenantID, userID string) string {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	payload := fmt.Sprintf("%s:%s:%s", tenantID, userID, ts)
	h := hmac.New(sha256.New, s.signingSecret)
	h.Write([]byte(payload))
	sig := hex.EncodeToString(h.Sum(nil))
	return payload + "." + sig
}

func (s *InteractiveService) getAuthenticatedUserFromCookie(ctx context.Context, r *http.Request) (*User, error) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil, ErrInvalidSessionCookie
	}

	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return nil, ErrInvalidSessionCookie
	}

	payload := parts[0]
	sig := parts[1]

	h := hmac.New(sha256.New, s.signingSecret)
	h.Write([]byte(payload))
	expectedSig := hex.EncodeToString(h.Sum(nil))

	if !hmac.Equal([]byte(sig), []byte(expectedSig)) {
		return nil, ErrInvalidSessionCookie
	}

	subparts := strings.Split(payload, ":")
	if len(subparts) != 3 {
		return nil, ErrInvalidSessionCookie
	}
	tenantID := subparts[0]
	userID := subparts[1]
	ts, err := strconv.ParseInt(subparts[2], 10, 64)
	if err != nil || time.Now().Unix()-ts > int64(sessionMaxAge.Seconds()) {
		return nil, ErrSessionExpired
	}

	return s.userRepo.GetUserByID(ctx, tenantID, userID)
}

func validRedirectURL(raw string) bool {
	if strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//") {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https")
}

func templateEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}
