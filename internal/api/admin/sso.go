package admin

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/idp"
	"project_alpha/internal/identity/oidc"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/identity/tokens"
)

// SSOProviderRequest represents an incoming payload to register or update an external IdP.
type SSOProviderRequest struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	IssuerURL    string            `json:"issuer_url"`
	ClientID     string            `json:"client_id"`
	ClientSecret string            `json:"client_secret,omitempty"`
	ClaimMapping map[string]string `json:"claim_mapping"`
	Active       bool              `json:"active"`
}

// HandleSSOProviders handles listing, creating, and deleting tenant-scoped OIDC providers.
func (h *Handler) HandleSSOProviders(w http.ResponseWriter, r *http.Request) {
	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.oidcRepo == nil {
		middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "oidc provider repository uninitialized"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		providers, err := h.oidcRepo.ListProviders(r.Context(), p.TenantID)
		if err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if providers == nil {
			providers = []*oidc.ProviderConfig{}
		}
		middleware.WriteJSON(w, http.StatusOK, providers)

	case http.MethodPost:
		var req SSOProviderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.Name == "" || req.IssuerURL == "" || req.ClientID == "" {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "name, issuer_url, and client_id are required"})
			return
		}

		if req.ID == "" {
			req.ID = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(req.Name), " ", "-"))
		}

		if req.ClaimMapping == nil {
			req.ClaimMapping = make(map[string]string)
		}

		provider := &oidc.ProviderConfig{
			ID:           req.ID,
			TenantID:     p.TenantID,
			Name:         req.Name,
			IssuerURL:    req.IssuerURL,
			ClientID:     req.ClientID,
			ClientSecret: req.ClientSecret,
			ClaimMapping: req.ClaimMapping,
			Active:       req.Active,
		}

		if err := h.oidcRepo.SaveProvider(r.Context(), provider); err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if h.recorder != nil {
			_ = h.recorder.Record(r.Context(), audit.Event{
				TenantID:   p.TenantID,
				ActorID:    p.Subject,
				ActorType:  audit.ActorTypeUser,
				Action:     "sso_provider.saved",
				ResourceID: req.ID,
				Outcome:    audit.OutcomeSuccess,
				Timestamp:  time.Now().UTC(),
				Metadata: map[string]any{
					"name":       req.Name,
					"issuer_url": req.IssuerURL,
					"client_id":  req.ClientID,
					"active":     req.Active,
				},
			})
		}

		middleware.WriteJSON(w, http.StatusOK, provider)

	case http.MethodDelete:
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/sso/providers/")
		id = strings.TrimSpace(id)
		if id == "" || id == "/api/v1/sso/providers" {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "provider id required"})
			return
		}

		if err := h.oidcRepo.DeleteProvider(r.Context(), p.TenantID, id); err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if h.recorder != nil {
			_ = h.recorder.Record(r.Context(), audit.Event{
				TenantID:   p.TenantID,
				ActorID:    p.Subject,
				ActorType:  audit.ActorTypeUser,
				Action:     "sso_provider.deleted",
				ResourceID: id,
				Outcome:    audit.OutcomeSuccess,
				Timestamp:  time.Now().UTC(),
			})
		}

		middleware.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleTestSSODiscovery performs a live check on remote .well-known/openid-configuration.
func (h *Handler) HandleTestSSODiscovery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IssuerURL string `json:"issuer_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.IssuerURL) == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "issuer_url is required"})
		return
	}

	discoverer := h.oidcDiscoverer
	if discoverer == nil {
		discoverer = oidc.NewDiscoverer(true, 5*time.Second)
	}

	start := time.Now()
	doc, err := discoverer.Discover(r.Context(), req.IssuerURL)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"status":     "error",
			"message":    err.Error(),
			"latency_ms": latency,
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"status":        "ok",
		"latency_ms":    latency,
		"configuration": doc,
	})
}

// HandlePublicSSOProviders returns active SSO provider names/IDs for the login screen.
func (h *Handler) HandlePublicSSOProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.URL.Query().Get("tenant_id")
	if tenantID == "" {
		tenantID = r.Header.Get("X-Tenant-ID")
	}
	if tenantID == "" {
		tenantID = "tenant-1"
	}

	if h.oidcRepo == nil {
		middleware.WriteJSON(w, http.StatusOK, []any{})
		return
	}

	providers, err := h.oidcRepo.ListProviders(r.Context(), tenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusOK, []any{})
		return
	}

	type PublicProvider struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		IssuerURL string `json:"issuer_url"`
	}

	var publicList []PublicProvider
	for _, p := range providers {
		if p.Active {
			publicList = append(publicList, PublicProvider{
				ID:        p.ID,
				Name:      p.Name,
				IssuerURL: p.IssuerURL,
			})
		}
	}
	if publicList == nil {
		publicList = []PublicProvider{}
	}

	middleware.WriteJSON(w, http.StatusOK, publicList)
}

// HandleSimulateSSOLogin handles testing/simulating federated login from a configured provider.
func (h *Handler) HandleSimulateSSOLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ProviderID string   `json:"provider_id"`
		TenantID   string   `json:"tenant_id"`
		Email      string   `json:"email"`
		Groups     []string `json:"groups"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	if req.TenantID == "" {
		req.TenantID = "tenant-1"
	}
	if req.Email == "" {
		req.Email = "sso-user@enterprise.local"
	}
	if len(req.Groups) == 0 {
		req.Groups = []string{"platform-admins", "engineering"}
	}

	provider, err := h.oidcRepo.GetProvider(r.Context(), req.TenantID, req.ProviderID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "provider not found or inactive"})
		return
	}

	// Map claims
	roles := []string{"tool-consumer"}
	for claimKey, mappedRole := range provider.ClaimMapping {
		for _, grp := range req.Groups {
			if strings.EqualFold(grp, claimKey) {
				roles = append(roles, mappedRole)
			}
		}
	}

	username := strings.Split(req.Email, "@")[0]

	// Provision or load user in user repo if available
	if h.userRepo != nil {
		u, err := h.userRepo.GetUserByUsername(r.Context(), req.TenantID, username)
		if err != nil && u == nil {
			_ = h.userRepo.CreateUser(r.Context(), &idp.User{
				TenantID: req.TenantID,
				Username: username,
				Email:    req.Email,
				Roles:    roles,
				Active:   true,
			}, "sso-federated-"+time.Now().String())
		}
	}

	if h.keyManager == nil {
		middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "key manager uninitialized"})
		return
	}

	activeKey, err := h.keyManager.GetActiveKey()
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed retrieving active key"})
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
		Subject:   username,
		Audience:  audience,
		TenantID:  req.TenantID,
		Roles:     roles,
		Scopes:    []string{"admin:read", "admin:write", "mcp:all", "a2a:all"},
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(24 * time.Hour).Unix(),
		TokenID:   uuid.NewString(),
	}

	token, err := tokens.Sign(claims, activeKey)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed minting token: " + err.Error()})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "gateway_console_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400,
	})

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user": map[string]any{
			"username":  username,
			"email":     req.Email,
			"tenant_id": req.TenantID,
			"roles":     roles,
		},
	})
}
