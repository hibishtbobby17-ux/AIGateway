package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"AIGateway/internal/a2a/protocol"
	"AIGateway/internal/a2a/registry"
	"AIGateway/internal/a2a/routing"
	"AIGateway/internal/a2a/tasks"
	"AIGateway/internal/audit"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/observability/correlation"
	"AIGateway/internal/policy"
)

// Handler implements HTTP routing for the A2A v1 protocol.
type Handler struct {
	registry        registry.Registry
	store           tasks.Store
	router          *routing.Router
	policyEngine    *policy.Engine
	auditRecorder   audit.Recorder
	defaultTenantID string
}

// NewHandler creates a new A2A transport Handler.
func NewHandler(
	reg registry.Registry,
	store tasks.Store,
	router *routing.Router,
	policyEngine *policy.Engine,
	auditRecorder audit.Recorder,
	defaultTenantID string,
) *Handler {
	if defaultTenantID == "" {
		defaultTenantID = "default"
	}
	return &Handler{
		registry:        reg,
		store:           store,
		router:          router,
		policyEngine:    policyEngine,
		auditRecorder:   auditRecorder,
		defaultTenantID: defaultTenantID,
	}
}

// Mount mounts A2A endpoints onto the provided http.ServeMux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("/a2a/v1/agents", h.HandleAgents)
	mux.HandleFunc("/a2a/v1/agents/", h.HandleAgentCard)
	mux.HandleFunc("/a2a/v1/tasks", h.HandleTasks)
	mux.HandleFunc("/a2a/v1/tasks/", h.HandleTaskDetail)
}

// HandleAgents lists registered agents subject to tenant isolation and discovery policy.
func (h *Handler) HandleAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed: must be GET")
		return
	}

	p := h.extractPrincipal(r)

	// Evaluate discovery policy
	if h.policyEngine != nil {
		allowed := h.policyEngine.IsAllowed(r.Context(), &policy.Context{
			Subject:    p.Subject,
			TenantID:   p.TenantID,
			Roles:      p.Roles,
			Scopes:     p.Scopes,
			Action:     policy.ActionA2AAgentsDiscover,
			Resource:   "*",
			Attributes: p.Attributes,
		})
		if !allowed {
			h.recordAudit(r.Context(), p.TenantID, p.Subject, policy.ActionA2AAgentsDiscover, "*", audit.OutcomeDenied, r)
			writeError(w, http.StatusForbidden, "access denied by policy")
			return
		}
	}

	agents, err := h.registry.ListAgents(r.Context(), p.TenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query agents")
		return
	}

	// Filter agents by policy if engine attached
	var response []*registry.Agent
	for _, a := range agents {
		if h.policyEngine != nil {
			agentRes := fmt.Sprintf("agent:%s", a.Name)
			if !h.policyEngine.IsAllowed(r.Context(), &policy.Context{
				Subject:    p.Subject,
				TenantID:   p.TenantID,
				Roles:      p.Roles,
				Scopes:     p.Scopes,
				Action:     policy.ActionA2AAgentsDiscover,
				Resource:   agentRes,
				Attributes: p.Attributes,
			}) {
				continue
			}
		}
		response = append(response, a)
	}

	if response == nil {
		response = []*registry.Agent{}
	}

	writeJSON(w, http.StatusOK, response)
}

// HandleAgentCard retrieves the Agent Card for a specific agent.
func (h *Handler) HandleAgentCard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed: must be GET")
		return
	}

	// Pattern: /a2a/v1/agents/{id}/card or /a2a/v1/agents/{id}
	path := strings.TrimPrefix(r.URL.Path, "/a2a/v1/agents/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusBadRequest, "agent id or name required")
		return
	}
	agentID := parts[0]

	p := h.extractPrincipal(r)

	// Fetch agent by ID or by Name
	agent, err := h.registry.GetAgent(r.Context(), p.TenantID, agentID)
	if err != nil {
		agent, err = h.registry.GetAgentByName(r.Context(), p.TenantID, agentID)
		if err != nil {
			writeError(w, http.StatusNotFound, "agent not found")
			return
		}
	}

	// Policy evaluation
	if h.policyEngine != nil {
		res := fmt.Sprintf("agent:%s", agent.Name)
		allowed := h.policyEngine.IsAllowed(r.Context(), &policy.Context{
			Subject:    p.Subject,
			TenantID:   p.TenantID,
			Roles:      p.Roles,
			Scopes:     p.Scopes,
			Action:     policy.ActionA2AAgentsDiscover,
			Resource:   res,
			Attributes: p.Attributes,
		})
		if !allowed {
			h.recordAudit(r.Context(), p.TenantID, p.Subject, policy.ActionA2AAgentsDiscover, res, audit.OutcomeDenied, r)
			writeError(w, http.StatusForbidden, "access denied by policy")
			return
		}
	}

	writeJSON(w, http.StatusOK, agent.AgentCard)
}

// HandleTasks handles task creation (POST) and task listing (GET).
func (h *Handler) HandleTasks(w http.ResponseWriter, r *http.Request) {
	p := h.extractPrincipal(r)

	switch r.Method {
	case http.MethodGet:
		status := r.URL.Query().Get("status")
		limit := 50
		if lStr := r.URL.Query().Get("limit"); lStr != "" {
			if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
				limit = l
			}
		}

		tasksList, err := h.store.ListTasks(r.Context(), p.TenantID, status, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to query tasks")
			return
		}
		if tasksList == nil {
			tasksList = []*protocol.Task{}
		}
		writeJSON(w, http.StatusOK, tasksList)

	case http.MethodPost:
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2*1024*1024))
		if err != nil {
			writeError(w, http.StatusBadRequest, "request body too large or invalid")
			return
		}

		var req protocol.TaskRequest
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, http.StatusBadRequest, "failed parsing task request: "+err.Error())
			return
		}
		if req.TargetAgentID == "" || len(req.InputPayload) == 0 {
			writeError(w, http.StatusBadRequest, "target_agent_id and input_payload are required")
			return
		}

		// Policy enforcement: action a2a:tasks:submit on agent
		if h.policyEngine != nil {
			res := fmt.Sprintf("agent:%s", req.TargetAgentID)
			allowed := h.policyEngine.IsAllowed(r.Context(), &policy.Context{
				Subject:    p.Subject,
				TenantID:   p.TenantID,
				Roles:      p.Roles,
				Scopes:     p.Scopes,
				Action:     policy.ActionA2ATasksSubmit,
				Resource:   res,
				Attributes: p.Attributes,
			})
			if !allowed {
				h.recordAudit(r.Context(), p.TenantID, p.Subject, audit.ActionA2ATaskSubmit, res, audit.OutcomeDenied, r)
				writeError(w, http.StatusForbidden, "task submission denied by policy")
				return
			}
		}

		traceID := extractTraceID(r)

		// Create task in durable store
		task := &protocol.Task{
			TenantID:       p.TenantID,
			CallerClientID: p.Subject,
			TargetAgentID:  req.TargetAgentID,
			IdempotencyKey: req.IdempotencyKey,
			Deadline:       req.Deadline,
			InputPayload:   req.InputPayload,
			TraceID:        traceID,
		}

		task, err = h.store.CreateTask(r.Context(), task)
		if err != nil {
			if errors.Is(err, protocol.ErrIdempotencyConflict) {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "failed creating task: "+err.Error())
			return
		}

		// Record audit log
		h.recordAudit(r.Context(), p.TenantID, p.Subject, audit.ActionA2ATaskSubmit, task.ID, audit.OutcomeSuccess, r)

		// If task was already completed from an idempotent replay, return immediately
		if task.IsTerminal() {
			writeJSON(w, http.StatusOK, task)
			return
		}

		isAsync := r.URL.Query().Get("async") == "true"
		if isAsync {
			// Asynchronous execution: dispatch in background goroutine
			go func() {
				bgCtx := correlation.WithContext(context.Background(), p.TenantID, task.TraceID, "")
				_, _ = h.router.ExecuteTask(bgCtx, task)
			}()
			writeJSON(w, http.StatusAccepted, task)
			return
		}

		// Synchronous execution: execute within inbound request context
		_, execErr := h.router.ExecuteTask(r.Context(), task)
		finalTask, getErr := h.store.GetTask(r.Context(), p.TenantID, task.ID)
		if getErr == nil {
			task = finalTask
		}

		if execErr != nil {
			if errors.Is(execErr, protocol.ErrTaskTimeout) {
				writeJSON(w, http.StatusGatewayTimeout, task)
				return
			}
			writeJSON(w, http.StatusBadGateway, task)
			return
		}

		writeJSON(w, http.StatusOK, task)

	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleTaskDetail handles /a2a/v1/tasks/{id}, /a2a/v1/tasks/{id}/cancel, and /a2a/v1/tasks/{id}/events.
func (h *Handler) HandleTaskDetail(w http.ResponseWriter, r *http.Request) {
	subPath := strings.TrimPrefix(r.URL.Path, "/a2a/v1/tasks/")
	parts := strings.Split(subPath, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusBadRequest, "task id required")
		return
	}
	taskID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	p := h.extractPrincipal(r)

	switch action {
	case "":
		// GET /a2a/v1/tasks/{id}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed: must be GET")
			return
		}
		task, err := h.store.GetTask(r.Context(), p.TenantID, taskID)
		if err != nil {
			if errors.Is(err, tasks.ErrTaskNotFound) {
				writeError(w, http.StatusNotFound, "task not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed getting task")
			return
		}
		writeJSON(w, http.StatusOK, task)

	case "cancel":
		// POST /a2a/v1/tasks/{id}/cancel
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed: must be POST")
			return
		}
		err := h.router.CancelTask(r.Context(), p.TenantID, taskID)
		if err != nil {
			if errors.Is(err, tasks.ErrTaskNotFound) {
				writeError(w, http.StatusNotFound, "task not found")
				return
			}
			if errors.Is(err, protocol.ErrTaskAlreadyDone) {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "failed cancelling task: "+err.Error())
			return
		}
		h.recordAudit(r.Context(), p.TenantID, p.Subject, audit.ActionA2ATaskCancel, taskID, audit.OutcomeSuccess, r)
		updatedTask, _ := h.store.GetTask(r.Context(), p.TenantID, taskID)
		writeJSON(w, http.StatusOK, updatedTask)

	case "events":
		// GET /a2a/v1/tasks/{id}/events (Server-Sent Events)
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed: must be GET")
			return
		}
		h.handleTaskEventsSSE(w, r, p.TenantID, taskID)

	default:
		writeError(w, http.StatusNotFound, "unknown sub-resource")
	}
}

func (h *Handler) handleTaskEventsSSE(w http.ResponseWriter, r *http.Request, tenantID, taskID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported by client connection")
		return
	}

	task, err := h.store.GetTask(r.Context(), tenantID, taskID)
	if err != nil {
		if errors.Is(err, tasks.ErrTaskNotFound) {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load task")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// 1. Replay historical events
	afterSeq := 0
	if aStr := r.URL.Query().Get("after"); aStr != "" {
		if s, err := strconv.Atoi(aStr); err == nil {
			afterSeq = s
		}
	}

	events, err := h.store.GetEvents(r.Context(), tenantID, taskID, afterSeq)
	if err == nil {
		for _, ev := range events {
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.SequenceNum, ev.EventType, string(ev.Payload))
			flusher.Flush()
		}
	}

	// 2. If task already reached a final status, terminate stream cleanly
	if task.IsTerminal() {
		return
	}

	// 3. Subscribe to real-time events
	eventChan, unsubscribe, err := h.store.SubscribeEvents(r.Context(), tenantID, taskID)
	if err != nil {
		return
	}
	defer unsubscribe()

	ctxDone := r.Context().Done()
	for {
		select {
		case <-ctxDone:
			return
		case ev, ok := <-eventChan:
			if !ok {
				return
			}
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.SequenceNum, ev.EventType, string(ev.Payload))
			flusher.Flush()

			// Check if event payload indicates terminal state
			var statusObj struct {
				Status string `json:"status"`
			}
			if err := json.Unmarshal(ev.Payload, &statusObj); err == nil {
				if statusObj.Status == protocol.StatusCompleted ||
					statusObj.Status == protocol.StatusFailed ||
					statusObj.Status == protocol.StatusTimedOut ||
					statusObj.Status == protocol.StatusCancelled {
					return
				}
			}
		}
	}
}

func (h *Handler) extractPrincipal(r *http.Request) principal.Principal {
	p, ok := principal.FromContext(r.Context())
	if ok && p.TenantID != "" {
		return p
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		tenantID = h.defaultTenantID
	}
	subject := "anonymous"
	if p.Subject != "" {
		subject = p.Subject
	}

	return principal.Principal{
		Subject:  subject,
		TenantID: tenantID,
		Roles:    []string{"agent-operator"},
		Scopes:   []string{"a2a:agents:discover", "a2a:tasks:submit", "a2a:read", "a2a:write"},
	}
}

func (h *Handler) recordAudit(ctx context.Context, tenantID, actorID, action, resourceID, outcome string, r *http.Request) {
	if h.auditRecorder == nil {
		return
	}
	traceID := extractTraceID(r)
	_ = h.auditRecorder.Record(ctx, audit.Event{
		TenantID:   tenantID,
		ActorID:    actorID,
		ActorType:  audit.ActorTypeUser,
		Action:     action,
		ResourceID: resourceID,
		Outcome:    outcome,
		ClientIP:   r.RemoteAddr,
		UserAgent:  r.UserAgent(),
		TraceID:    traceID,
		Timestamp:  time.Now().UTC(),
	})
}

func extractTraceID(r *http.Request) string {
	if r == nil {
		return ""
	}
	if tid := r.Header.Get("X-Trace-ID"); tid != "" {
		return tid
	}
	if tp := r.Header.Get("traceparent"); tp != "" {
		parts := strings.Split(tp, "-")
		if len(parts) >= 3 {
			return parts[1]
		}
	}
	if val, ok := r.Context().Value(correlation.TraceIDKey).(string); ok {
		return val
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
