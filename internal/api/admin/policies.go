package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/policy"
)

// HandlePolicies routes policy management and dry-run simulation:
//   GET    /api/v1/policies
//   POST   /api/v1/policies
//   DELETE /api/v1/policies/{id}
//   POST   /api/v1/policies/dry-run
func (h *Handler) HandlePolicies(w http.ResponseWriter, r *http.Request) {
	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/policies")
	path = strings.Trim(path, "/")

	if path == "" {
		switch r.Method {
		case http.MethodGet:
			h.HandleListPolicies(w, r)
		case http.MethodPost:
			h.HandleCreatePolicy(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	if path == "dry-run" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleDryRunPolicy(w, r, p)
		return
	}

	policyID := path
	if r.Method == http.MethodDelete {
		h.handleDeletePolicy(w, r, p, policyID)
		return
	}

	http.NotFound(w, r)
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
	if rules == nil {
		rules = []*policy.Rule{}
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

func (h *Handler) handleDeletePolicy(w http.ResponseWriter, r *http.Request, p principal.Principal, policyID string) {
	err := h.policyRepo.DeleteRule(r.Context(), p.TenantID, policyID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "policy rule not found"})
		return
	}

	if h.recorder != nil {
		_ = h.recorder.Record(r.Context(), audit.Event{
			TenantID:   p.TenantID,
			ActorID:    p.Subject,
			ActorType:  audit.ActorTypeUser,
			Action:     audit.ActionPolicyDelete,
			ResourceID: policyID,
			Outcome:    audit.OutcomeSuccess,
			ClientIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
		})
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": policyID})
}

// DryRunRequest specifies evaluation parameters for a simulated authorization check.
type DryRunRequest struct {
	Subject    string         `json:"subject"`
	Roles      []string       `json:"roles"`
	Scopes     []string       `json:"scopes"`
	Action     string         `json:"action"`
	Resource   string         `json:"resource"`
	Attributes map[string]any `json:"attributes"`
}

// DryRunResponse reports the outcome of a dry-run policy evaluation.
type DryRunResponse struct {
	Decision         string   `json:"decision"` // "ALLOW" or "DENY"
	Effect           string   `json:"effect"`   // "ALLOW" or "DENY"
	MatchedRuleID    string   `json:"matched_rule_id,omitempty"`
	MatchedRuleName  string   `json:"matched_rule_name,omitempty"`
	EvaluationReason string   `json:"evaluation_reason"`
	TenantID         string   `json:"tenant_id"`
}

func (h *Handler) handleDryRunPolicy(w http.ResponseWriter, r *http.Request, p principal.Principal) {
	var dryReq DryRunRequest
	if err := json.NewDecoder(r.Body).Decode(&dryReq); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid dry-run payload"})
		return
	}

	// Fetch rules strictly for the caller's tenant
	rules, err := h.policyRepo.ListRules(r.Context(), p.TenantID)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	simEngine := policy.NewEngine()
	for _, rule := range rules {
		_ = simEngine.AddRule(rule)
	}

	evalCtx := &policy.Context{
		TenantID:   p.TenantID,
		Subject:    dryReq.Subject,
		Roles:      dryReq.Roles,
		Scopes:     dryReq.Scopes,
		Action:     dryReq.Action,
		Resource:   dryReq.Resource,
		Attributes: dryReq.Attributes,
	}

	allowed := simEngine.IsAllowed(r.Context(), evalCtx)
	decision := "DENY"
	reason := "denied by default policy"
	if allowed {
		decision = "ALLOW"
		reason = "allowed by matching authorization rule"
	}

	resp := DryRunResponse{
		Decision:         decision,
		Effect:           decision,
		EvaluationReason: reason,
		TenantID:         p.TenantID,
	}

	for _, rule := range rules {
		if rule.TenantID == p.TenantID {
			for _, act := range rule.Actions {
				if act == dryReq.Action || act == "*" {
					resp.MatchedRuleID = rule.ID
					resp.MatchedRuleName = rule.Name
					break
				}
			}
		}
	}

	middleware.WriteJSON(w, http.StatusOK, resp)
}
