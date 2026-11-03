package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"AIGateway/internal/a2a/protocol"
	a2aregistry "AIGateway/internal/a2a/registry"
	"AIGateway/internal/api/middleware"
	"AIGateway/internal/audit"
	"AIGateway/internal/identity/principal"
)

// HandleAgents routes A2A agent management endpoints:
//   GET    /api/v1/agents
//   POST   /api/v1/agents
//   GET    /api/v1/agents/{id}
//   PUT    /api/v1/agents/{id}
//   DELETE /api/v1/agents/{id}
//   POST   /api/v1/agents/{id}/health
func (h *Handler) HandleAgents(w http.ResponseWriter, r *http.Request) {
	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.a2aRegistry == nil {
		middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "a2a registry not configured"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/agents")
	path = strings.Trim(path, "/")

	if path == "" {
		switch r.Method {
		case http.MethodGet:
			h.listAgents(w, r, p)
		case http.MethodPost:
			h.createAgent(w, r, p)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	parts := strings.Split(path, "/")
	agentID := parts[0]

	if len(parts) == 2 && parts[1] == "health" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.testAgentHealth(w, r, p, agentID)
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			h.getAgent(w, r, p, agentID)
		case http.MethodPut:
			h.updateAgent(w, r, p, agentID)
		case http.MethodDelete:
			h.deleteAgent(w, r, p, agentID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	http.NotFound(w, r)
}

func (h *Handler) listAgents(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	agents, err := h.a2aRegistry.ListAgents(r.Context(), p.TenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if agents == nil {
		agents = []*a2aregistry.Agent{}
	}
	middleware.WriteJSON(w, http.StatusOK, agents)
}

func (h *Handler) createAgent(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	var a a2aregistry.Agent
	if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	if strings.TrimSpace(a.Name) == "" || strings.TrimSpace(a.EndpointURL) == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "name and endpoint_url are required"})
		return
	}

	a.TenantID = p.TenantID
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	if a.ProtocolVersion == "" {
		a.ProtocolVersion = protocol.ProtocolVersion
	}
	if a.AuthType == "" {
		a.AuthType = "NONE"
	}
	a.HealthStatus = "HEALTHY"
	a.CreatedAt = time.Now().UTC()

	// Ensure minimal default agent card if not provided
	if a.AgentCard.Name == "" {
		a.AgentCard.Name = a.Name
	}
	if a.AgentCard.ProtocolVersion == "" {
		a.AgentCard.ProtocolVersion = protocol.ProtocolVersion
	}

	if err := h.a2aRegistry.RegisterAgent(r.Context(), &a); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if h.recorder != nil {
		_ = h.recorder.Record(r.Context(), audit.Event{
			TenantID:   p.TenantID,
			ActorID:    p.Subject,
			ActorType:  audit.ActorTypeUser,
			Action:     audit.ActionAgentRegister,
			ResourceID: a.ID,
			Outcome:    audit.OutcomeSuccess,
			ClientIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
			Metadata: map[string]any{
				"agent_name":   a.Name,
				"endpoint_url": a.EndpointURL,
			},
		})
	}

	middleware.WriteJSON(w, http.StatusCreated, a)
}

func (h *Handler) getAgent(w http.ResponseWriter, r *http.Request, p principal.Principal, agentID string) {
	a, err := h.a2aRegistry.GetAgent(r.Context(), p.TenantID, agentID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	middleware.WriteJSON(w, http.StatusOK, a)
}

func (h *Handler) updateAgent(w http.ResponseWriter, r *http.Request, p principal.Principal, agentID string) {
	var a a2aregistry.Agent
	if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	a.ID = agentID
	a.TenantID = p.TenantID
	if a.AgentCard.Name == "" {
		a.AgentCard.Name = a.Name
	}
	if a.AgentCard.ProtocolVersion == "" {
		a.AgentCard.ProtocolVersion = protocol.ProtocolVersion
	}

	if err := h.a2aRegistry.UpdateAgent(r.Context(), &a); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	updated, err := h.a2aRegistry.GetAgent(r.Context(), p.TenantID, agentID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusOK, a)
		return
	}
	middleware.WriteJSON(w, http.StatusOK, updated)
}

func (h *Handler) deleteAgent(w http.ResponseWriter, r *http.Request, p principal.Principal, agentID string) {
	err := h.a2aRegistry.DeleteAgent(r.Context(), p.TenantID, agentID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}

	if h.recorder != nil {
		_ = h.recorder.Record(r.Context(), audit.Event{
			TenantID:   p.TenantID,
			ActorID:    p.Subject,
			ActorType:  audit.ActorTypeUser,
			Action:     audit.ActionAgentRemove,
			ResourceID: agentID,
			Outcome:    audit.OutcomeSuccess,
			ClientIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
		})
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": agentID})
}

func (h *Handler) testAgentHealth(w http.ResponseWriter, r *http.Request, p principal.Principal, agentID string) {
	a, err := h.a2aRegistry.GetAgent(r.Context(), p.TenantID, agentID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}

	start := time.Now()
	healthStatus := "HEALTHY"
	message := "Agent endpoint is healthy and responding"
	var httpStatus int

	if a.EndpointURL != "" {
		probeCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		req, reqErr := http.NewRequestWithContext(probeCtx, http.MethodGet, a.EndpointURL, nil)
		if reqErr != nil {
			healthStatus = "UNHEALTHY"
			message = fmt.Sprintf("invalid endpoint url: %v", reqErr)
		} else {
			resp, doErr := h.httpClient.Do(req)
			if doErr != nil {
				healthStatus = "UNHEALTHY"
				message = fmt.Sprintf("agent connection failed: %v", doErr)
			} else {
				defer resp.Body.Close()
				httpStatus = resp.StatusCode
				if resp.StatusCode >= 500 {
					healthStatus = "UNHEALTHY"
					message = fmt.Sprintf("agent returned server error HTTP %d", resp.StatusCode)
				} else if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
					healthStatus = "DEGRADED"
					message = fmt.Sprintf("agent reachable but requires valid credentials (HTTP %d)", resp.StatusCode)
				} else {
					message = fmt.Sprintf("agent reachable and responded with HTTP %d", resp.StatusCode)
				}
			}
		}
	}

	latencyMs := float64(time.Since(start).Microseconds()) / 1000.0

	_ = h.a2aRegistry.UpdateHealth(r.Context(), p.TenantID, agentID, healthStatus)

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"agent_id":      agentID,
		"health":        healthStatus,
		"health_status": healthStatus,
		"message":       message,
		"latency_ms":    latencyMs,
		"http_status":   httpStatus,
		"checked_at":    time.Now().UTC(),
	})
}
