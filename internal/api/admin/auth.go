package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"project_alpha/internal/identity/idp"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/identity/tokens"
)

// LoginRequest defines credentials submitted to /api/v1/auth/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	TenantID string `json:"tenant_id,omitempty"`
}

// UserSummary defines user profile information returned upon login or /me.
type UserSummary struct {
	ID       string   `json:"id"`
	Username string   `json:"username"`
	Email    string   `json:"email"`
	TenantID string   `json:"tenant_id"`
	Roles    []string `json:"roles"`
}

// LoginResponse defines response payload for successful authentication.
type LoginResponse struct {
	Token string      `json:"token"`
	User  UserSummary `json:"user"`
}

// HandleLogin authenticates an operator with username and password, issues a signed JWT,
// and sets a secure HttpOnly session cookie.
func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request json body")
			return
		}
	} else {
		if err := r.ParseForm(); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid form data")
			return
		}
		req.Username = r.FormValue("username")
		req.Password = r.FormValue("password")
		req.TenantID = r.FormValue("tenant_id")
	}

	req.Username = strings.TrimSpace(req.Username)
	req.TenantID = strings.TrimSpace(req.TenantID)

	if req.Username == "" || req.Password == "" {
		writeJSONError(w, http.StatusBadRequest, "username and password are required")
		return
	}

	if h.userRepo == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "user authentication service unavailable")
		return
	}

	user, err := h.userRepo.Authenticate(r.Context(), req.TenantID, req.Username, req.Password)
	if err != nil {
		if errors.Is(err, idp.ErrUserInactive) {
			writeJSONError(w, http.StatusForbidden, "user account is deactivated")
			return
		}
		writeJSONError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}

	if h.keyManager == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "signing key manager unavailable")
		return
	}

	activeKey, err := h.keyManager.GetActiveKey()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to retrieve active signing key")
		return
	}

	now := time.Now().UTC()
	issuer := h.jwtIssuer
	if issuer == "" {
		issuer = "https://gateway.local"
	}
	audience := h.jwtAudience
	if audience == "" {
		audience = "gateway-api"
	}

	claims := &tokens.Claims{
		Issuer:    issuer,
		Subject:   user.ID,
		Audience:  audience,
		TenantID:  user.TenantID,
		Roles:     user.Roles,
		Scopes:    []string{"admin:read", "admin:write", "mcp:all", "a2a:all"},
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(24 * time.Hour).Unix(),
		TokenID:   uuid.NewString(),
	}

	tokenStr, err := tokens.Sign(claims, activeKey)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to mint authentication token")
		return
	}

	// Set session cookie for web browser console
	http.SetCookie(w, &http.Cookie{
		Name:     "gateway_console_session",
		Value:    tokenStr,
		Path:     "/",
		MaxAge:   86400, // 24 hours
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(LoginResponse{
		Token: tokenStr,
		User: UserSummary{
			ID:       user.ID,
			Username: user.Username,
			Email:    user.Email,
			TenantID: user.TenantID,
			Roles:    user.Roles,
		},
	})
}

// HandleLogout clears the session cookie and returns a success confirmation.
func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "gateway_console_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "logged_out"})
}

// HandleMe returns the currently authenticated user's profile and roles.
func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	p, ok := principal.FromContext(r.Context())
	if !ok || p.Subject == "" {
		writeJSONError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if h.userRepo != nil {
		user, err := h.userRepo.GetUserByID(r.Context(), p.TenantID, p.Subject)
		if err == nil && user != nil {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(UserSummary{
				ID:       user.ID,
				Username: user.Username,
				Email:    user.Email,
				TenantID: user.TenantID,
				Roles:    user.Roles,
			})
			return
		}
	}

	// Fallback to caller principal
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(UserSummary{
		ID:       p.Subject,
		Username: p.Subject,
		TenantID: p.TenantID,
		Roles:    p.Roles,
	})
}

func writeJSONError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
