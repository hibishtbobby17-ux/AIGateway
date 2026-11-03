package admin

import (
	"net/http"
	"time"

	"AIGateway/internal/api/middleware"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/observability/model"
)

// HandleGetConfiguredTopology returns the static registered topology of the tenant.
//   GET /api/v1/topology/configured
func (h *Handler) HandleGetConfiguredTopology(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	nodes := make([]model.TopologyNode, 0)
	edges := make([]model.TopologyEdge, 0)

	// Central Gateway Node
	nodes = append(nodes, model.TopologyNode{
		ID:        "gateway",
		Label:     "AI Gateway",
		Type:      "gateway",
		Status:    "HEALTHY",
		CallCount: 0,
		Metadata: map[string]any{
			"version": "1.0.0",
			"status":  "ONLINE",
		},
	})

	// 1. Registered MCP Servers
	if h.mcpRegistry != nil {
		servers, err := h.mcpRegistry.ListServers(r.Context(), p.TenantID)
		if err == nil {
			for _, s := range servers {
				nodeID := "mcp:" + s.Name
				nodes = append(nodes, model.TopologyNode{
					ID:     nodeID,
					Label:  s.Name,
					Type:   "mcp_server",
					Status: s.HealthStatus,
					Metadata: map[string]any{
						"id":                s.ID,
						"namespace_prefix":  s.NamespacePrefix,
						"transport_type":    s.TransportType,
						"endpoint_url":      s.EndpointURL,
						"timeout_ms":        s.TimeoutMs,
						"concurrency_limit": s.ConcurrencyLimit,
					},
				})

				edges = append(edges, model.TopologyEdge{
					ID:       "gateway->" + nodeID,
					Source:   "gateway",
					Target:   nodeID,
					Protocol: "mcp",
				})
			}
		}
	}

	// 2. Registered A2A Autonomous Agents
	if h.a2aRegistry != nil {
		agents, err := h.a2aRegistry.ListAgents(r.Context(), p.TenantID)
		if err == nil {
			for _, a := range agents {
				nodeID := "agent:" + a.Name
				nodes = append(nodes, model.TopologyNode{
					ID:     nodeID,
					Label:  a.Name,
					Type:   "agent",
					Status: a.HealthStatus,
					Metadata: map[string]any{
						"id":               a.ID,
						"endpoint_url":     a.EndpointURL,
						"protocol_version": a.ProtocolVersion,
						"description":      a.AgentCard.Description,
						"capabilities":     a.AgentCard.Capabilities,
					},
				})

				edges = append(edges, model.TopologyEdge{
					ID:       "gateway->" + nodeID,
					Source:   "gateway",
					Target:   nodeID,
					Protocol: "a2a",
				})
			}
		}
	}

	configured := model.ConfiguredTopology{
		TenantID: p.TenantID,
		Nodes:    nodes,
		Edges:    edges,
	}

	middleware.WriteJSON(w, http.StatusOK, configured)
}

// HandleGetObservedTopology returns the dynamic interaction graph aggregated from telemetry spans.
//   GET /api/v1/topology/observed?duration=1h
func (h *Handler) HandleGetObservedTopology(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.traceStore == nil {
		middleware.WriteJSON(w, http.StatusOK, model.ObservedTopology{
			TenantID:       p.TenantID,
			TimeRangeStart: time.Now().Add(-1 * time.Hour),
			TimeRangeEnd:   time.Now(),
			Nodes:          []model.TopologyNode{},
			Edges:          []model.TopologyEdge{},
		})
		return
	}

	now := time.Now().UTC()
	startTime := now.Add(-1 * time.Hour)
	endTime := now

	if durStr := r.URL.Query().Get("duration"); durStr != "" {
		switch durStr {
		case "15m":
			startTime = now.Add(-15 * time.Minute)
		case "1h":
			startTime = now.Add(-1 * time.Hour)
		case "6h":
			startTime = now.Add(-6 * time.Hour)
		case "24h":
			startTime = now.Add(-24 * time.Hour)
		case "7d":
			startTime = now.Add(-7 * 24 * time.Hour)
		default:
			if d, err := time.ParseDuration(durStr); err == nil && d > 0 {
				startTime = now.Add(-d)
			}
		}
	}

	if startQuery := r.URL.Query().Get("start"); startQuery != "" {
		if t, err := time.Parse(time.RFC3339, startQuery); err == nil {
			startTime = t
		}
	}
	if endQuery := r.URL.Query().Get("end"); endQuery != "" {
		if t, err := time.Parse(time.RFC3339, endQuery); err == nil {
			endTime = t
		}
	}

	topo, err := h.traceStore.GetObservedTopology(r.Context(), p.TenantID, startTime, endTime)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, topo)
}
