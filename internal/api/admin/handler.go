package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
)

// Handler serves administrative Control Plane REST APIs.
type Handler struct {
	recorder    audit.Recorder
	policyRepo  *policy.SQLRepository
	tenantsRepo *storage.SQLTenantRepository
}

// NewHandler creates a new administrative API handler.
func NewHandler(recorder audit.Recorder, policyRepo *policy.SQLRepository, tenantsRepo *storage.SQLTenantRepository) *Handler {
	return &Handler{
		recorder:    recorder,
		policyRepo:  policyRepo,
		tenantsRepo: tenantsRepo,
	}
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

	middleware.WriteJSON(w, http.StatusOK, events)
}

// HandleListPolicies returns policies scoped to caller's tenant.
func (h *Handler) HandleListPolicies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rules, err := h.policyRepo.ListRules(r.Context(), p.TenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, rules)
}

// HandleCreatePolicy creates a new policy rule for the caller's tenant and records an audit event.
func (h *Handler) HandleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var rule policy.Rule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid policy JSON payload"})
		return
	}

	// Strictly enforce tenant isolation: caller can ONLY create policies in their own tenant
	rule.TenantID = p.TenantID

	if rule.ID == "" {
		idBytes := make([]byte, 16)
		_, _ = rand.Read(idBytes)
		rule.ID = hex.EncodeToString(idBytes)
	}

	if err := h.policyRepo.CreateRule(r.Context(), &rule); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// Record security audit event
	if h.recorder != nil {
		_ = h.recorder.Record(r.Context(), audit.Event{
			TenantID:   p.TenantID,
			ActorID:    p.Subject,
			ActorType:  audit.ActorTypeUser,
			Action:     audit.ActionPolicyCreate,
			ResourceID: rule.ID,
			Outcome:    audit.OutcomeSuccess,
			ClientIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
			Metadata: map[string]any{
				"rule_id": rule.ID,
				"name":    rule.Name,
				"effect":  string(rule.Effect),
				"actions": rule.Actions,
			},
		})
	}

	middleware.WriteJSON(w, http.StatusCreated, rule)
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
