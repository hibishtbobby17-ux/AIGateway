package admin

import (
	"net/http"
	"strconv"
	"strings"

	"project_alpha/internal/a2a/protocol"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/identity/principal"
	obsstorage "project_alpha/internal/observability/storage"
)

// HandleA2ATasks routes A2A task history and event timeline endpoints:
//   GET /api/v1/a2a/tasks
//   GET /api/v1/a2a/tasks/{id}
func (h *Handler) HandleA2ATasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.tasksStore == nil {
		middleware.WriteJSON(w, http.StatusOK, []*protocol.Task{})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/a2a/tasks")
	path = strings.Trim(path, "/")

	if path == "" {
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 200 {
				limit = val
			}
		}
		status := r.URL.Query().Get("status")

		tasks, err := h.tasksStore.ListTasks(r.Context(), p.TenantID, status, limit)
		if err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if tasks == nil {
			tasks = []*protocol.Task{}
		}
		middleware.WriteJSON(w, http.StatusOK, tasks)
		return
	}

	taskID := path
	task, err := h.tasksStore.GetTask(r.Context(), p.TenantID, taskID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
		return
	}

	events, _ := h.tasksStore.GetEvents(r.Context(), p.TenantID, taskID, 0)
	if events == nil {
		events = []*protocol.TaskEvent{}
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"task":   task,
		"events": events,
	})
}

// MCPInvocationSummary provides a concise overview of an individual tool execution.
type MCPInvocationSummary struct {
	SpanID        string  `json:"span_id"`
	TraceID       string  `json:"trace_id"`
	ServerName    string  `json:"server_name"`
	ToolName      string  `json:"tool_name"`
	DurationMs    float64 `json:"duration_ms"`
	StatusCode    string  `json:"status_code"`
	StatusMessage string  `json:"status_message,omitempty"`
	Timestamp     string  `json:"timestamp"`
}

// HandleMCPInvocations returns recent MCP tool call invocations extracted from telemetry:
//   GET /api/v1/mcp/invocations
func (h *Handler) HandleMCPInvocations(w http.ResponseWriter, r *http.Request) {
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
		middleware.WriteJSON(w, http.StatusOK, []MCPInvocationSummary{})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 200 {
			limit = val
		}
	}

	filter := obsstorage.TraceFilter{
		TenantID: p.TenantID,
		Limit:    limit,
	}

	spans, err := h.traceStore.QuerySpans(r.Context(), filter)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	var invocations []MCPInvocationSummary
	for _, s := range spans {
		if s == nil {
			continue
		}
		isMCP := strings.HasPrefix(s.Name, "mcp.")
		serverName := "mcp-upstream"
		toolName := s.Name

		if s.Attributes != nil {
			if sn, ok := s.Attributes["mcp.server_name"].(string); ok && sn != "" {
				serverName = sn
				isMCP = true
			}
			if tn, ok := s.Attributes["mcp.tool_name"].(string); ok && tn != "" {
				toolName = tn
				isMCP = true
			}
		}

		if isMCP {
			invocations = append(invocations, MCPInvocationSummary{
				SpanID:        s.SpanID,
				TraceID:       s.TraceID,
				ServerName:    serverName,
				ToolName:      toolName,
				DurationMs:    s.DurationMs,
				StatusCode:    s.StatusCode,
				StatusMessage: s.StatusMessage,
				Timestamp:     s.StartTime.Format("2006-01-02T15:04:05Z07:00"),
			})
		}
	}

	if invocations == nil {
		invocations = []MCPInvocationSummary{}
	}

	middleware.WriteJSON(w, http.StatusOK, invocations)
}
