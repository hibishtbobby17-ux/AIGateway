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
	"project_alpha/internal/identity/principal"
	mcpregistry "project_alpha/internal/mcp/registry"
)

// HandleMCPServers routes MCP server management endpoints:
//   GET    /api/v1/mcp-servers
//   POST   /api/v1/mcp-servers
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

func (h *Handler) listMCPServers(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	servers, err := h.mcpRegistry.ListServers(r.Context(), p.TenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if servers == nil {
		servers = []*mcpregistry.ServerRegistration{}
	}
	middleware.WriteJSON(w, http.StatusOK, servers)
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
			},
		})
	}

	middleware.WriteJSON(w, http.StatusCreated, s)
}

func (h *Handler) getMCPServer(w http.ResponseWriter, r *http.Request, p principal.Principal, serverID string) {
	s, err := h.mcpRegistry.GetServer(r.Context(), p.TenantID, serverID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "mcp server not found"})
		return
	}
	middleware.WriteJSON(w, http.StatusOK, s)
}

func (h *Handler) updateMCPServer(w http.ResponseWriter, r *http.Request, p principal.Principal, serverID string) {
	var s mcpregistry.ServerRegistration
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	s.ID = serverID
	s.TenantID = p.TenantID

	if err := h.mcpRegistry.UpdateServer(r.Context(), &s); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	updated, err := h.mcpRegistry.GetServer(r.Context(), p.TenantID, serverID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusOK, s)
		return
	}
	middleware.WriteJSON(w, http.StatusOK, updated)
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
			if s.AuthHeader != "" {
				req.Header.Set("Authorization", s.AuthHeader)
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
