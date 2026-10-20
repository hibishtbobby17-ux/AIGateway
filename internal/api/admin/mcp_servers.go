package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/identity/principal"
	mcpregistry "project_alpha/internal/mcp/registry"
	"project_alpha/internal/mcp/upstream"
)

// HandleMCPServers routes MCP server management endpoints:
//   GET    /api/v1/mcp-servers
//   POST   /api/v1/mcp-servers
//   POST   /api/v1/mcp-servers/test-oauth
//   GET    /api/v1/mcp-servers/{id}
//   PUT    /api/v1/mcp-servers/{id}
//   DELETE /api/v1/mcp-servers/{id}
//   POST   /api/v1/mcp-servers/{id}/health
func (h *Handler) HandleMCPServers(w http.ResponseWriter, r *http.Request) {
	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.mcpRegistry == nil {
		middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "mcp registry not configured"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/mcp-servers")
	path = strings.Trim(path, "/")

	if path == "" {
		switch r.Method {
		case http.MethodGet:
			h.listMCPServers(w, r, p)
		case http.MethodPost:
			h.createMCPServer(w, r, p)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	if path == "test-oauth" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.testMCPOAuth(w, r, p)
		return
	}

	parts := strings.Split(path, "/")
	serverID := parts[0]

	if len(parts) == 2 && parts[1] == "health" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.testMCPHealth(w, r, p, serverID)
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			h.getMCPServer(w, r, p, serverID)
		case http.MethodPut:
			h.updateMCPServer(w, r, p, serverID)
		case http.MethodDelete:
			h.deleteMCPServer(w, r, p, serverID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	http.NotFound(w, r)
}

func sanitizeServer(s *mcpregistry.ServerRegistration) *mcpregistry.ServerRegistration {
	if s == nil {
		return nil
	}
	clone := *s
	if clone.AuthConfig.ClientSecret != "" {
		clone.AuthConfig.ClientSecret = "••••••••"
	}
	if clone.AuthConfig.Password != "" {
		clone.AuthConfig.Password = "••••••••"
	}
	if clone.AuthConfig.StaticToken != "" && len(clone.AuthConfig.StaticToken) > 8 {
		clone.AuthConfig.StaticToken = clone.AuthConfig.StaticToken[:4] + "••••"
	}
	return &clone
}

func (h *Handler) listMCPServers(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	servers, err := h.mcpRegistry.ListServers(r.Context(), p.TenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var sanitized []*mcpregistry.ServerRegistration
	for _, s := range servers {
		sanitized = append(sanitized, sanitizeServer(s))
	}
	if sanitized == nil {
		sanitized = []*mcpregistry.ServerRegistration{}
	}
	middleware.WriteJSON(w, http.StatusOK, sanitized)
}

func (h *Handler) createMCPServer(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	var s mcpregistry.ServerRegistration
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	if strings.TrimSpace(s.Name) == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}

	// Validate OAuth2 configuration if chosen
	if s.AuthConfig.Type == delegation.TypeOAuth2ClientCredentials {
		if strings.TrimSpace(s.AuthConfig.TokenEndpoint) == "" || strings.TrimSpace(s.AuthConfig.ClientID) == "" {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "token_endpoint and client_id are required for OAUTH2_CLIENT_CREDENTIALS"})
			return
		}
	}

	s.TenantID = p.TenantID
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	if s.NamespacePrefix == "" {
		s.NamespacePrefix = s.Name
	}
	if s.TransportType == "" {
		s.TransportType = "SSE"
	}
	if s.TimeoutMs <= 0 {
		s.TimeoutMs = 10000
	}
	if s.ConcurrencyLimit <= 0 {
		s.ConcurrencyLimit = 50
	}
	s.HealthStatus = "UNKNOWN"
	s.CreatedAt = time.Now().UTC()

	if err := h.mcpRegistry.RegisterServer(r.Context(), &s); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if h.recorder != nil {
		_ = h.recorder.Record(r.Context(), audit.Event{
			TenantID:   p.TenantID,
			ActorID:    p.Subject,
			ActorType:  audit.ActorTypeUser,
			Action:     audit.ActionServerRegister,
			ResourceID: s.ID,
			Outcome:    audit.OutcomeSuccess,
			ClientIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
			Metadata: map[string]any{
				"server_name":    s.Name,
				"transport_type": s.TransportType,
				"endpoint_url":   s.EndpointURL,
				"auth_type":      s.AuthConfig.Type,
			},
		})
	}

	middleware.WriteJSON(w, http.StatusCreated, sanitizeServer(&s))
}

func (h *Handler) getMCPServer(w http.ResponseWriter, r *http.Request, p principal.Principal, serverID string) {
	s, err := h.mcpRegistry.GetServer(r.Context(), p.TenantID, serverID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "mcp server not found"})
		return
	}
	middleware.WriteJSON(w, http.StatusOK, sanitizeServer(s))
}

func (h *Handler) updateMCPServer(w http.ResponseWriter, r *http.Request, p principal.Principal, serverID string) {
	var s mcpregistry.ServerRegistration
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	// Fetch existing to preserve client_secret if masked
	existing, _ := h.mcpRegistry.GetServer(r.Context(), p.TenantID, serverID)
	if existing != nil {
		if s.AuthConfig.ClientSecret == "••••••••" || s.AuthConfig.ClientSecret == "" {
			s.AuthConfig.ClientSecret = existing.AuthConfig.ClientSecret
		}
		if s.AuthConfig.Password == "••••••••" || s.AuthConfig.Password == "" {
			s.AuthConfig.Password = existing.AuthConfig.Password
		}
		if strings.HasSuffix(s.AuthConfig.StaticToken, "••••") || s.AuthConfig.StaticToken == "" {
			s.AuthConfig.StaticToken = existing.AuthConfig.StaticToken
		}
	}

	s.ID = serverID
	s.TenantID = p.TenantID

	if err := h.mcpRegistry.UpdateServer(r.Context(), &s); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	updated, err := h.mcpRegistry.GetServer(r.Context(), p.TenantID, serverID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusOK, sanitizeServer(&s))
		return
	}
	middleware.WriteJSON(w, http.StatusOK, sanitizeServer(updated))
}

func (h *Handler) deleteMCPServer(w http.ResponseWriter, r *http.Request, p principal.Principal, serverID string) {
	err := h.mcpRegistry.RemoveServer(r.Context(), p.TenantID, serverID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "mcp server not found"})
		return
	}

	if h.recorder != nil {
		_ = h.recorder.Record(r.Context(), audit.Event{
			TenantID:   p.TenantID,
			ActorID:    p.Subject,
			ActorType:  audit.ActorTypeUser,
			Action:     audit.ActionServerRemove,
			ResourceID: serverID,
			Outcome:    audit.OutcomeSuccess,
			ClientIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
		})
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": serverID})
}

func (h *Handler) testMCPOAuth(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	var req struct {
		TokenEndpoint string `json:"token_endpoint"`
		ClientID      string `json:"client_id"`
		ClientSecret  string `json:"client_secret"`
		Scopes        string `json:"scopes"`
		Audience      string `json:"audience"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	if req.TokenEndpoint == "" || req.ClientID == "" || req.ClientSecret == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "token_endpoint, client_id, and client_secret are required"})
		return
	}

	oauthProvider := h.oauthProvider
	if oauthProvider == nil {
		oauthProvider = upstream.NewOAuthTokenProvider(5*time.Second, true)
	}

	res, err := oauthProvider.FetchTokenDirect(r.Context(), req.TokenEndpoint, req.ClientID, req.ClientSecret, req.Scopes, req.Audience)
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, res)
		return
	}

	middleware.WriteJSON(w, http.StatusOK, res)
}

func (h *Handler) testMCPHealth(w http.ResponseWriter, r *http.Request, p principal.Principal, serverID string) {
	s, err := h.mcpRegistry.GetServer(r.Context(), p.TenantID, serverID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "mcp server not found"})
		return
	}

	start := time.Now()
	healthStatus := "HEALTHY"
	message := "Upstream server is healthy and responding"
	var httpStatus int

	if s.EndpointURL != "" {
		probeCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		req, reqErr := http.NewRequestWithContext(probeCtx, http.MethodGet, s.EndpointURL, nil)
		if reqErr != nil {
			healthStatus = "UNHEALTHY"
			message = fmt.Sprintf("invalid endpoint url: %v", reqErr)
		} else {
			// Resolve OAuth2 or Bearer credentials for probe
			if s.AuthConfig.Type == delegation.TypeOAuth2ClientCredentials {
				oauthProvider := h.oauthProvider
				if oauthProvider == nil {
					oauthProvider = upstream.NewOAuthTokenProvider(3*time.Second, true)
				}
				tok, tokErr := oauthProvider.GetToken(probeCtx, s.ID, s.AuthConfig)
				if tokErr == nil && tok != "" {
					req.Header.Set("Authorization", "Bearer "+tok)
				}
			} else if s.AuthHeader != "" {
				req.Header.Set("Authorization", s.AuthHeader)
			} else if s.AuthConfig.StaticToken != "" {
				req.Header.Set("Authorization", "Bearer "+s.AuthConfig.StaticToken)
			}

			resp, doErr := h.httpClient.Do(req)
			if doErr != nil {
				healthStatus = "UNHEALTHY"
				message = fmt.Sprintf("connection failed: %v", doErr)
			} else {
				defer resp.Body.Close()
				httpStatus = resp.StatusCode
				if resp.StatusCode >= 500 {
					healthStatus = "UNHEALTHY"
					message = fmt.Sprintf("upstream returned server error HTTP %d", resp.StatusCode)
				} else if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
					healthStatus = "DEGRADED"
					message = fmt.Sprintf("upstream reachable but requires valid credentials (HTTP %d)", resp.StatusCode)
				} else {
					message = fmt.Sprintf("upstream reachable and responded with HTTP %d", resp.StatusCode)
				}
			}
		}
	} else if s.Command != "" {
		message = fmt.Sprintf("STDIO command configured: %s", s.Command)
	}

	latencyMs := float64(time.Since(start).Microseconds()) / 1000.0

	// Persist health update
	_ = h.mcpRegistry.UpdateHealth(r.Context(), p.TenantID, serverID, healthStatus)

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"server_id":     serverID,
		"health":        healthStatus,
		"health_status": healthStatus,
		"message":       message,
		"latency_ms":    latencyMs,
		"http_status":   httpStatus,
		"checked_at":    time.Now().UTC(),
	})
}
