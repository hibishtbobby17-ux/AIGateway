package admin

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"AIGateway/internal/api/middleware"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/observability/model"
	obsstorage "AIGateway/internal/observability/storage"
)

// HandleTraces routes distributed trace search and waterfall endpoints:
//   GET /api/v1/traces
//   GET /api/v1/traces/{id}
func (h *Handler) HandleTraces(w http.ResponseWriter, r *http.Request) {
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
		middleware.WriteJSON(w, http.StatusOK, []*model.TraceSummary{})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/traces")
	path = strings.Trim(path, "/")

	if path == "" {
		h.listTraces(w, r, p)
		return
	}

	traceID := path
	h.getTraceWaterfall(w, r, p, traceID)
}

func (h *Handler) listTraces(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 200 {
			limit = val
		}
	}

	filter := obsstorage.TraceFilter{
		TenantID:   p.TenantID,
		TraceID:    r.URL.Query().Get("trace_id"),
		Name:       r.URL.Query().Get("name"),
		StatusCode: r.URL.Query().Get("status_code"),
		Limit:      limit,
	}

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			filter.StartTime = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			filter.EndTime = t
		}
	}

	summaries, err := h.traceStore.GetTraceSummaries(r.Context(), filter)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if summaries == nil {
		summaries = []*model.TraceSummary{}
	}

	middleware.WriteJSON(w, http.StatusOK, summaries)
}

func (h *Handler) getTraceWaterfall(w http.ResponseWriter, r *http.Request, p principal.Principal, traceID string) {
	spans, err := h.traceStore.GetTrace(r.Context(), p.TenantID, traceID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "trace not found"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"trace_id":    traceID,
		"span_count":  len(spans),
		"spans":       spans,
	})
}

// HandleLogs routes correlated structured log search:
//   GET /api/v1/logs
func (h *Handler) HandleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.logStore == nil {
		middleware.WriteJSON(w, http.StatusOK, []*model.LogRecord{})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 200 {
			limit = val
		}
	}

	filter := obsstorage.LogFilter{
		TenantID: p.TenantID,
		TraceID:  r.URL.Query().Get("trace_id"),
		Severity: r.URL.Query().Get("severity"),
		Query:    r.URL.Query().Get("query"),
		Limit:    limit,
	}

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			filter.StartTime = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			filter.EndTime = t
		}
	}

	logs, err := h.logStore.QueryLogs(r.Context(), filter)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if logs == nil {
		logs = []*model.LogRecord{}
	}

	middleware.WriteJSON(w, http.StatusOK, logs)
}

// HandleMetricsSummary routes aggregated operational metrics:
//   GET /api/v1/metrics/summary
func (h *Handler) HandleMetricsSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	now := time.Now().UTC()
	startTime := now.Add(-24 * time.Hour)
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

	summary := &model.MetricsSummary{
		TenantID:         p.TenantID,
		TimeRangeStart:   startTime,
		TimeRangeEnd:     endTime,
		TopTools:         make(map[string]int64),
		TaskStatusCounts: make(map[string]int64),
	}

	if h.traceStore != nil {
		if s, err := h.traceStore.GetMetricsSummary(r.Context(), p.TenantID, startTime, endTime); err == nil && s != nil {
			summary = s
		}
	}

	// Enrich with active server count from MCP Registry
	if h.mcpRegistry != nil {
		if servers, err := h.mcpRegistry.ListServers(r.Context(), p.TenantID); err == nil {
			summary.ActiveMCPServers = len(servers)
		}
	}

	// Enrich with active agent count from A2A Registry
	if h.a2aRegistry != nil {
		if agents, err := h.a2aRegistry.ListAgents(r.Context(), p.TenantID); err == nil {
			summary.ActiveAgents = len(agents)
		}
	}

	middleware.WriteJSON(w, http.StatusOK, summary)
}
