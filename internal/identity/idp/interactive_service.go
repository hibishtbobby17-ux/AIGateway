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
		_, _ = fmt.Fprint(w, renderLoginPage(returnTo, tenantID))

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
		_, _ = fmt.Fprint(w, renderConsentPage(clientID, user.TenantID, user.Username, scopes, returnTo))

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

func renderLoginPage(returnTo, tenantID string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Sign In &bull; AI Gateway Identity Provider</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #080c14;
      background-image:
        radial-gradient(ellipse at 20%% 20%%, rgba(6, 182, 212, 0.12), transparent 45%%),
        radial-gradient(ellipse at 80%% 80%%, rgba(59, 130, 246, 0.10), transparent 45%%);
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .portal-card {
      width: 100%%;
      max-width: 440px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 2.25rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(6, 182, 212, 0.05);
    }
    .header-badge {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      margin-bottom: 1.5rem;
    }
    .logo-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: linear-gradient(135deg, #06b6d4 0%%, #3b82f6 100%%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 0 15px rgba(6, 182, 212, 0.4);
    }
    .portal-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
    }
    .portal-subtitle {
      font-size: 0.825rem;
      color: #94a3b8;
      margin-top: 0.2rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    .form-label {
      display: block;
      font-size: 0.775rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 0.45rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .form-input {
      width: 100%%;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: #ffffff;
      font-size: 0.925rem;
      outline: none;
      transition: all 0.2s ease;
    }
    .form-input:focus {
      border-color: #06b6d4;
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.2);
      background: rgba(30, 41, 59, 0.9);
    }
    .btn-primary {
      width: 100%%;
      background: linear-gradient(135deg, #06b6d4 0%%, #3b82f6 100%%);
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0.85rem;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
      transition: all 0.2s ease;
      margin-top: 0.5rem;
    }
    .btn-primary:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .security-note {
      font-size: 0.75rem;
      color: #64748b;
      text-align: center;
      margin-top: 1.5rem;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="portal-card">
    <div class="header-badge">
      <div class="logo-icon">&#9889;</div>
      <div>
        <div class="portal-title">AI Gateway Identity</div>
        <div class="portal-subtitle">Sign in to authorize application access</div>
      </div>
    </div>
    <form method="POST" action="/login">
      <input type="hidden" name="return_to" value="%s"/>
      <div class="form-group">
        <label class="form-label">Tenant Identifier</label>
        <input type="text" name="tenant_id" value="%s" required class="form-input" placeholder="e.g. tenant-1"/>
      </div>
      <div class="form-group">
        <label class="form-label">Username</label>
        <input type="text" name="username" required class="form-input" placeholder="Enter username"/>
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input type="password" name="password" required class="form-input" placeholder="Enter password"/>
      </div>
      <button type="submit" class="btn-primary">Sign In &amp; Continue</button>
    </form>
    <div class="security-note">
      Protected by AI Gateway OAuth 2.0 / OIDC Authorization Server<br/>
      End-to-end encrypted session verification
    </div>
  </div>
</body>
</html>`, templateEscape(returnTo), templateEscape(tenantID))
}

func renderConsentPage(clientID, tenantID, username, scopes, returnTo string) string {
	scopeList := strings.Fields(scopes)
	var scopesHTML strings.Builder
	if len(scopeList) == 0 {
		scopesHTML.WriteString(`<div class="scope-item"><span class="scope-icon">&#9889;</span><div><div class="scope-name">basic:profile</div><div class="scope-desc">Access to basic tenant identity and principal profile</div></div></div>`)
	} else {
		for _, s := range scopeList {
			desc := "Standard operational resource access"
			icon := "&#9889;"
			if strings.Contains(s, "tool") {
				desc = "Inspect and invoke upstream MCP registered tools"
				icon = "&#128295;"
			} else if strings.Contains(s, "read") {
				desc = "Read telemetry, configuration, and agent state"
				icon = "&#128269;"
			} else if strings.Contains(s, "admin") {
				desc = "Administrative management and policy delegation"
				icon = "&#128737;"
			} else if strings.Contains(s, "offline") {
				desc = "Maintain long-lived offline refresh token access"
				icon = "&#128273;"
			}
			scopesHTML.WriteString(fmt.Sprintf(`
        <div class="scope-item">
          <span class="scope-icon">%s</span>
          <div>
            <div class="scope-name">%s</div>
            <div class="scope-desc">%s</div>
          </div>
        </div>`, icon, templateEscape(s), desc))
		}
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Authorize Application &bull; AI Gateway</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #080c14;
      background-image:
        radial-gradient(ellipse at 20%% 20%%, rgba(6, 182, 212, 0.12), transparent 45%%),
        radial-gradient(ellipse at 80%% 80%%, rgba(59, 130, 246, 0.10), transparent 45%%);
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .portal-card {
      width: 100%%;
      max-width: 480px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 2.25rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(6, 182, 212, 0.05);
    }
    .header-badge {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      margin-bottom: 1.25rem;
    }
    .logo-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: linear-gradient(135deg, #06b6d4 0%%, #3b82f6 100%%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      box-shadow: 0 0 15px rgba(6, 182, 212, 0.4);
    }
    .portal-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
    }
    .portal-subtitle {
      font-size: 0.825rem;
      color: #94a3b8;
      margin-top: 0.2rem;
    }
    .info-box {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 1rem;
      margin-bottom: 1.25rem;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      padding: 0.25rem 0;
    }
    .info-row:not(:last-child) {
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 0.45rem;
      margin-bottom: 0.45rem;
    }
    .info-label { color: #94a3b8; }
    .info-value { color: #f8fafc; font-weight: 600; font-family: monospace; }
    .section-title {
      font-size: 0.775rem;
      font-weight: 600;
      color: #cbd5e1;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.65rem;
    }
    .scopes-container {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      max-height: 200px;
      overflow-y: auto;
    }
    .scope-item {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 0.65rem 0.75rem;
    }
    .scope-icon {
      font-size: 1rem;
      color: #22d3ee;
      padding-top: 0.1rem;
    }
    .scope-name {
      font-size: 0.825rem;
      font-weight: 600;
      color: #22d3ee;
      font-family: monospace;
    }
    .scope-desc {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-top: 0.15rem;
    }
    .btn-group {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    .btn-approve {
      flex: 1;
      background: linear-gradient(135deg, #06b6d4 0%%, #3b82f6 100%%);
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0.85rem;
      font-size: 0.925rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
      transition: all 0.2s ease;
    }
    .btn-approve:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-deny {
      flex: 1;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      border-radius: 8px;
      padding: 0.85rem;
      font-size: 0.925rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-deny:hover { background: rgba(239, 68, 68, 0.2); color: #ffffff; }
    .security-note {
      font-size: 0.75rem;
      color: #64748b;
      text-align: center;
      margin-top: 1.25rem;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="portal-card">
    <div class="header-badge">
      <div class="logo-icon">&#128737;</div>
      <div>
        <div class="portal-title">Authorization Request</div>
        <div class="portal-subtitle">AI Gateway Identity &bull; OAuth 2.0 Consent</div>
      </div>
    </div>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Client Application</span>
        <span class="info-value">%s</span>
      </div>
      <div class="info-row">
        <span class="info-label">Tenant Domain</span>
        <span class="info-value">%s</span>
      </div>
      <div class="info-row">
        <span class="info-label">Signed-in User</span>
        <span class="info-value">%s</span>
      </div>
    </div>

    <div class="section-title">Requested Scopes &amp; Permissions</div>
    <div class="scopes-container">
      %s
    </div>

    <form method="POST" action="/consent">
      <input type="hidden" name="client_id" value="%s"/>
      <input type="hidden" name="scope" value="%s"/>
      <input type="hidden" name="return_to" value="%s"/>
      <div class="btn-group">
        <button type="submit" name="decision" value="deny" class="btn-deny">Deny</button>
        <button type="submit" name="decision" value="approve" class="btn-approve">Authorize</button>
      </div>
    </form>

    <div class="security-note">
      Authorizing permits this application to interact with your resources according to the displayed scopes until revoked in the Management Console.
    </div>
  </div>
</body>
</html>`,
		templateEscape(clientID),
		templateEscape(tenantID),
		templateEscape(username),
		scopesHTML.String(),
		templateEscape(clientID),
		templateEscape(scopes),
		templateEscape(returnTo),
	)
}
