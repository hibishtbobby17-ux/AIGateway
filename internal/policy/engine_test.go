package policy

import (
	"context"
	"testing"
)

func TestEngineEvaluatesTenantRoleScopeAndABACConditions(t *testing.T) {
	engine := NewEngine()
	if err := engine.AddRule(&Rule{
		ID: "allow-tool", TenantID: "tenant-1", Name: "tool access", Effect: EffectAllow,
		Actions: []string{ActionMCPToolsCall}, Resources: []string{"github::*"},
		Roles: []string{RoleToolConsumer}, RequiredScopes: []string{"mcp:tools:call"},
		Conditions: map[string]any{"environment": "production", "groups": []any{"engineering"}},
	}); err != nil {
		t.Fatalf("add allow rule: %v", err)
	}
	valid := &Context{
		Subject: "user-1", TenantID: "tenant-1", Roles: []string{RoleToolConsumer},
		Scopes: []string{"mcp:tools:call"}, Action: ActionMCPToolsCall,
		Resource: "github::search", Attributes: map[string]any{
			"environment": "production", "groups": []any{"engineering"},
		},
	}
	if !engine.IsAllowed(context.Background(), valid) {
		t.Fatal("matching tenant, role, scope, and ABAC attributes were denied")
	}

	tests := []struct {
		name   string
		change func(*Context)
	}{
		{name: "wrong tenant", change: func(c *Context) { c.TenantID = "tenant-2" }},
		{name: "missing subject", change: func(c *Context) { c.Subject = "" }},
		{name: "missing role", change: func(c *Context) { c.Roles = nil }},
		{name: "missing scope", change: func(c *Context) { c.Scopes = nil }},
		{name: "wrong action scope", change: func(c *Context) { c.Scopes = []string{"mcp:read"} }},
		{name: "wrong attribute", change: func(c *Context) { c.Attributes["environment"] = "development" }},
		{name: "wrong resource", change: func(c *Context) { c.Resource = "postgres::query" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			eval := *valid
			eval.Roles = append([]string(nil), valid.Roles...)
			eval.Scopes = append([]string(nil), valid.Scopes...)
			eval.Attributes = map[string]any{
				"environment": "production", "groups": []any{"engineering"},
			}
			test.change(&eval)
			if engine.IsAllowed(context.Background(), &eval) {
				t.Fatal("non-matching policy context was allowed")
			}
		})
	}
}

func TestEngineExplicitDenyOverridesPlatformAdmin(t *testing.T) {
	engine := NewEngine()
	if err := engine.AddRule(&Rule{
		TenantID: "tenant-1", Name: "deny dangerous action", Effect: EffectDeny,
		Actions: []string{ActionMCPToolsCall}, Resources: []string{"github::delete"},
	}); err != nil {
		t.Fatalf("add deny rule: %v", err)
	}
	if engine.IsAllowed(context.Background(), &Context{
		Subject: "admin-1", TenantID: "tenant-1", Roles: []string{RolePlatformAdmin}, Scopes: []string{"mcp:tools:call"},
		Action: ActionMCPToolsCall, Resource: "github::delete",
	}) {
		t.Fatal("platform admin bypassed an explicit deny rule")
	}
	if !engine.IsAllowed(context.Background(), &Context{
		Subject: "admin-1", TenantID: "tenant-1", Roles: []string{RolePlatformAdmin}, Scopes: []string{"mcp:tools:call"},
		Action: ActionMCPToolsCall, Resource: "github::read",
	}) {
		t.Fatal("platform admin did not receive default role bypass")
	}
}

func TestEngineRejectsInvalidRule(t *testing.T) {
	engine := NewEngine()
	if err := engine.AddRule(nil); err == nil {
		t.Fatal("nil rule was accepted")
	}
	if err := engine.AddRule(&Rule{
		TenantID: "tenant-1", Name: "invalid", Effect: "MAYBE",
		Actions: []string{"*"}, Resources: []string{"*"},
	}); err == nil {
		t.Fatal("invalid policy effect was accepted")
	}
}
