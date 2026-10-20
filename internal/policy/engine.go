package policy

import (
	"context"
	"errors"
	"fmt"
	"path"
	"reflect"
	"strings"
	"sync"
)

// Effect defines policy permission outcome.
type Effect string

const (
	EffectAllow Effect = "ALLOW"
	EffectDeny  Effect = "DENY"
)

// Standard Action Constants.
const (
	ActionMCPToolsDiscover  = "mcp:tools:discover"
	ActionMCPToolsCall      = "mcp:tools:call"
	ActionMCPResourcesRead  = "mcp:resources:read"
	ActionMCPPromptsRead    = "mcp:prompts:read"
	ActionA2ATasksSubmit    = "a2a:tasks:submit"
	ActionA2AAgentsDiscover = "a2a:agents:discover"
	ActionAdminAll          = "admin:*"
)

// Standard Roles.
const (
	RolePlatformAdmin = "platform-admin"
	RoleTenantAdmin   = "tenant-admin"
	RoleToolConsumer  = "tool-consumer"
	RoleAgentOperator = "agent-operator"
	RoleAuditor       = "auditor"
)

// Rule represents an RBAC/ABAC authorization rule.
type Rule struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	Name           string         `json:"name"`
	Effect         Effect         `json:"effect"` // ALLOW or DENY
	Actions        []string       `json:"actions"`
	Resources      []string       `json:"resources"` // e.g. ["github::*", "*"]
	Roles          []string       `json:"roles,omitempty"`
	RequiredScopes []string       `json:"required_scopes,omitempty"`
	Conditions     map[string]any `json:"conditions,omitempty"`
}

// Context contains caller attributes for policy evaluation.
type Context struct {
	Subject    string         `json:"subject"`
	TenantID   string         `json:"tenant_id"`
	Roles      []string       `json:"roles"`
	Scopes     []string       `json:"scopes"`
	Action     string         `json:"action"`
	Resource   string         `json:"resource"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// Engine coordinates multi-tenant RBAC and ABAC policy evaluation.
type Engine struct {
	mu    sync.RWMutex
	rules map[string][]*Rule // key: tenant_id
}

// NewEngine creates an empty policy engine that denies requests by default.
func NewEngine() *Engine {
	return &Engine{
		rules: make(map[string][]*Rule),
	}
}

// AddRule adds an authorization rule to a tenant's policy set.
func (e *Engine) AddRule(r *Rule) error {
	if r == nil || r.TenantID == "" || r.Name == "" || len(r.Actions) == 0 || len(r.Resources) == 0 {
		return errors.New("policy rule requires tenant, name, actions, and resources")
	}
	if r.Effect != EffectAllow && r.Effect != EffectDeny {
		return fmt.Errorf("policy rule effect must be ALLOW or DENY")
	}
	rule := *r
	rule.Actions = append([]string(nil), r.Actions...)
	rule.Resources = append([]string(nil), r.Resources...)
	rule.Roles = append([]string(nil), r.Roles...)
	rule.RequiredScopes = append([]string(nil), r.RequiredScopes...)
	rule.Conditions = cloneConditions(r.Conditions)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.rules[rule.TenantID] = append(e.rules[rule.TenantID], &rule)
	return nil
}

// IsAllowed evaluates whether the caller in evalCtx is permitted to perform the action on the resource.
// Defaults to DENY unless an explicit ALLOW matches and no explicit DENY overrides.
func (e *Engine) IsAllowed(ctx context.Context, evalCtx *Context) bool {
	if evalCtx == nil || evalCtx.Subject == "" || evalCtx.TenantID == "" || evalCtx.Action == "" || evalCtx.Resource == "" {
		return false
	}
	if !scopeAllowsAction(evalCtx.Scopes, evalCtx.Action) {
		return false
	}

	e.mu.RLock()
	rules := append([]*Rule(nil), e.rules[evalCtx.TenantID]...)
	e.mu.RUnlock()

	allowed := false

	for _, rule := range rules {
		if rule == nil || rule.TenantID != evalCtx.TenantID {
			continue
		}
		if !matchAction(rule.Actions, evalCtx.Action) {
			continue
		}
		if !matchResource(rule.Resources, evalCtx.Resource) {
			continue
		}
		if len(rule.Roles) > 0 && !hasAnyRole(evalCtx.Roles, rule.Roles) {
			continue
		}
		if !containsAll(evalCtx.Scopes, rule.RequiredScopes) {
			continue
		}
		if !matchConditions(rule.Conditions, evalCtx.Attributes) {
			continue
		}

		// Explicit DENY takes precedence over any ALLOW
		if rule.Effect == EffectDeny {
			return false
		}

		if rule.Effect == EffectAllow {
			allowed = true
		}
	}

	for _, role := range evalCtx.Roles {
		if role == RolePlatformAdmin {
			return true
		}
	}
	return allowed
}

func scopeAllowsAction(scopes []string, action string) bool {
	var required []string
	switch action {
	case ActionMCPToolsDiscover:
		required = []string{"mcp:tools:discover", "mcp:read"}
	case ActionMCPToolsCall:
		required = []string{"mcp:tools:call", "mcp:write"}
	case ActionMCPResourcesRead:
		required = []string{"mcp:resources:read", "mcp:read"}
	case ActionMCPPromptsRead:
		required = []string{"mcp:prompts:read", "mcp:read"}
	default:
		return true
	}
	for _, scope := range scopes {
		for _, allowed := range required {
			if scope == allowed {
				return true
			}
		}
	}
	return false
}

func containsAll(values, required []string) bool {
	for _, item := range required {
		found := false
		for _, value := range values {
			if value == item {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func cloneConditions(conditions map[string]any) map[string]any {
	if conditions == nil {
		return nil
	}
	cloned := make(map[string]any, len(conditions))
	for key, value := range conditions {
		cloned[key] = cloneConditionValue(value)
	}
	return cloned
}

func cloneConditionValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneConditions(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, item := range typed {
			cloned[index] = cloneConditionValue(item)
		}
		return cloned
	case []string:
		return append([]string(nil), typed...)
	default:
		return value
	}
}

func matchAction(patterns []string, action string) bool {
	for _, p := range patterns {
		if p == "*" || p == action {
			return true
		}
		// Glob prefix match (e.g. "mcp:tools:*")
		if strings.HasSuffix(p, "*") && strings.HasPrefix(action, strings.TrimSuffix(p, "*")) {
			return true
		}
	}
	return false
}

func matchResource(patterns []string, resource string) bool {
	for _, p := range patterns {
		if p == "*" || p == resource {
			return true
		}
		// Glob match (e.g. "github::*")
		matched, _ := path.Match(p, resource)
		if matched {
			return true
		}
		if strings.HasSuffix(p, "*") && strings.HasPrefix(resource, strings.TrimSuffix(p, "*")) {
			return true
		}
	}
	return false
}

func hasAnyRole(callerRoles, requiredRoles []string) bool {
	for _, cr := range callerRoles {
		for _, rr := range requiredRoles {
			if cr == rr {
				return true
			}
		}
	}
	return false
}

func matchConditions(required map[string]any, actual map[string]any) bool {
	if len(required) == 0 {
		return true
	}
	if actual == nil {
		return false
	}
	for k, reqVal := range required {
		actVal, ok := actual[k]
		if !ok || !reflect.DeepEqual(actVal, reqVal) {
			return false
		}
	}
	return true
}
