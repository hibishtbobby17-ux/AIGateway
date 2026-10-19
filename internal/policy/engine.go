package policy

import (
	"context"
	"path"
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
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id"`
	Name       string         `json:"name"`
	Effect     Effect         `json:"effect"` // ALLOW or DENY
	Actions    []string       `json:"actions"`
	Resources  []string       `json:"resources"` // e.g. ["github::*", "*"]
	Roles      []string       `json:"roles,omitempty"`
	Conditions map[string]any `json:"conditions,omitempty"`
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

// NewEngine creates a new policy engine pre-populated with safe defaults.
func NewEngine() *Engine {
	return &Engine{
		rules: make(map[string][]*Rule),
	}
}

// AddRule adds an authorization rule to a tenant's policy set.
func (e *Engine) AddRule(r *Rule) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.rules[r.TenantID] = append(e.rules[r.TenantID], r)
}

// IsAllowed evaluates whether the caller in evalCtx is permitted to perform the action on the resource.
// Defaults to DENY unless an explicit ALLOW matches and no explicit DENY overrides.
func (e *Engine) IsAllowed(ctx context.Context, evalCtx *Context) bool {
	if evalCtx == nil {
		return false
	}

	// 1. Superuser / Platform Admin bypass within system
	for _, r := range evalCtx.Roles {
		if r == RolePlatformAdmin {
			return true
		}
	}

	e.mu.RLock()
	rules := e.rules[evalCtx.TenantID]
	e.mu.RUnlock()

	allowed := false

	for _, rule := range rules {
		if !matchAction(rule.Actions, evalCtx.Action) {
			continue
		}
		if !matchResource(rule.Resources, evalCtx.Resource) {
			continue
		}
		if len(rule.Roles) > 0 && !hasAnyRole(evalCtx.Roles, rule.Roles) {
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

	return allowed
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
		if !ok || actVal != reqVal {
			return false
		}
	}
	return true
}
