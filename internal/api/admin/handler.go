package admin

import (
	"net/http"
	"time"

	a2aregistry "project_alpha/internal/a2a/registry"
	"project_alpha/internal/a2a/tasks"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/idp"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/principal"
	mcpregistry "project_alpha/internal/mcp/registry"
	obsstorage "project_alpha/internal/observability/storage"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
)

// Config holds all subsystem dependencies for the administrative control plane.
type Config struct {
	Recorder     audit.Recorder
	PolicyRepo   *policy.SQLRepository
	TenantsRepo  *storage.SQLTenantRepository
	MCPRegistry  mcpregistry.Registry
	A2ARegistry  a2aregistry.Registry
	TasksStore   tasks.Store
	TraceStore   obsstorage.TraceStore
	LogStore     obsstorage.LogStore
	PolicyEngine *policy.Engine
	HTTPClient   *http.Client
	UserRepo     idp.UserRepository
	KeyManager   *keys.Manager
	JWTIssuer    string
	JWTAudience  string
}

// Handler serves administrative Control Plane REST APIs.
type Handler struct {
	recorder     audit.Recorder
	policyRepo   *policy.SQLRepository
	tenantsRepo  *storage.SQLTenantRepository
	mcpRegistry  mcpregistry.Registry
	a2aRegistry  a2aregistry.Registry
	tasksStore   tasks.Store
	traceStore   obsstorage.TraceStore
	logStore     obsstorage.LogStore
	policyEngine *policy.Engine
	httpClient   *http.Client
	userRepo     idp.UserRepository
	keyManager   *keys.Manager
	jwtIssuer    string
	jwtAudience  string
}

// NewHandler creates a new administrative API handler with core repositories.
func NewHandler(recorder audit.Recorder, policyRepo *policy.SQLRepository, tenantsRepo *storage.SQLTenantRepository) *Handler {
	return NewHandlerWithConfig(Config{
		Recorder:    recorder,
		PolicyRepo:  policyRepo,
		TenantsRepo: tenantsRepo,
	})
}

// NewHandlerWithConfig creates a new administrative API handler with complete subsystem configuration.
func NewHandlerWithConfig(cfg Config) *Handler {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &Handler{
		recorder:     cfg.Recorder,
		policyRepo:   cfg.PolicyRepo,
		tenantsRepo:  cfg.TenantsRepo,
		mcpRegistry:  cfg.MCPRegistry,
		a2aRegistry:  cfg.A2ARegistry,
		tasksStore:   cfg.TasksStore,
		traceStore:   cfg.TraceStore,
		logStore:     cfg.LogStore,
		policyEngine: cfg.PolicyEngine,
		httpClient:   client,
		userRepo:     cfg.UserRepo,
		keyManager:   cfg.KeyManager,
		jwtIssuer:    cfg.JWTIssuer,
		jwtAudience:  cfg.JWTAudience,
	}
}

// RegisterRoutes registers all tenant-scoped administrative endpoints onto the provided multiplexer.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/audit", h.HandleGetAudit)
	mux.HandleFunc("/api/v1/auth/me", h.HandleMe)
	mux.HandleFunc("/api/v1/tenants", h.HandleGetTenant)
	mux.HandleFunc("/api/v1/projects", h.HandleProjects)
	mux.HandleFunc("/api/v1/mcp-servers", h.HandleMCPServers)
	mux.HandleFunc("/api/v1/mcp-servers/", h.HandleMCPServers)
	mux.HandleFunc("/api/v1/agents", h.HandleAgents)
	mux.HandleFunc("/api/v1/agents/", h.HandleAgents)
	mux.HandleFunc("/api/v1/topology/configured", h.HandleGetConfiguredTopology)
	mux.HandleFunc("/api/v1/topology/observed", h.HandleGetObservedTopology)
	mux.HandleFunc("/api/v1/traces", h.HandleTraces)
	mux.HandleFunc("/api/v1/traces/", h.HandleTraces)
	mux.HandleFunc("/api/v1/logs", h.HandleLogs)
	mux.HandleFunc("/api/v1/metrics/summary", h.HandleMetricsSummary)
	mux.HandleFunc("/api/v1/a2a/tasks", h.HandleA2ATasks)
	mux.HandleFunc("/api/v1/a2a/tasks/", h.HandleA2ATasks)
	mux.HandleFunc("/api/v1/mcp/invocations", h.HandleMCPInvocations)
	mux.HandleFunc("/api/v1/policies", h.HandlePolicies)
	mux.HandleFunc("/api/v1/policies/", h.HandlePolicies)
}

// HandleGetAudit queries tenant-scoped audit logs.
func (h *Handler) HandleGetAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	filter := audit.Filter{
		TenantID: p.TenantID,
		Action:   r.URL.Query().Get("action"),
		ActorID:  r.URL.Query().Get("actor_id"),
		Outcome:  r.URL.Query().Get("outcome"),
	}

	events, err := h.recorder.Query(r.Context(), filter)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if events == nil {
		events = []audit.Event{}
	}

	middleware.WriteJSON(w, http.StatusOK, events)
}

// HandleGetTenant returns the caller's tenant metadata.
func (h *Handler) HandleGetTenant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	tenant, err := h.tenantsRepo.GetTenantByID(r.Context(), p.TenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "tenant not found"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, tenant)
}
