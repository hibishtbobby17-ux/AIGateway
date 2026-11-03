package transport

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"AIGateway/internal/identity/principal"
	"AIGateway/internal/mcp/aggregation"
	"AIGateway/internal/mcp/protocol"
	"AIGateway/internal/mcp/registry"
	"AIGateway/internal/mcp/session"
	"AIGateway/internal/mcp/upstream"
	"AIGateway/internal/policy"
)

func TestPolicyFiltersMCPDiscoveryAndBlocksInvocation(t *testing.T) {
	ctx := principal.WithContext(context.Background(), principal.Principal{
		Subject: "user-1", TenantID: "tenant-1", Roles: []string{policy.RoleToolConsumer},
		Scopes:     []string{"mcp:read", "mcp:tools:call"},
		Attributes: map[string]any{"environment": "production"},
	})
	reg := registry.NewMemoryRegistry()
	mock := upstream.NewMockClient()
	mock.AddTool(protocol.Tool{Name: "allowed"}, func(json.RawMessage) (*protocol.CallToolResult, error) {
		return &protocol.CallToolResult{Content: []protocol.ToolContent{{Type: "text", Text: "ran"}}}, nil
	})
	mock.AddTool(protocol.Tool{Name: "denied"}, func(json.RawMessage) (*protocol.CallToolResult, error) {
		t.Error("denied tool handler was executed")
		return nil, nil
	})
	mock.AddResource(protocol.Resource{URI: "file://allowed", Name: "allowed"})
	mock.AddResource(protocol.Resource{URI: "file://denied", Name: "denied"})
	mock.AddPrompt(protocol.Prompt{Name: "allowed"})
	mock.AddPrompt(protocol.Prompt{Name: "denied"})
	if err := reg.RegisterServer(context.Background(), &registry.ServerRegistration{
		ID: "server-1", TenantID: "tenant-1", Name: "server", NamespacePrefix: "server",
		TimeoutMs: 1000, Client: mock,
	}); err != nil {
		t.Fatalf("register test server: %v", err)
	}

	engine := policy.NewEngine()
	for _, action := range []string{
		policy.ActionMCPToolsDiscover, policy.ActionMCPResourcesRead, policy.ActionMCPPromptsRead,
		policy.ActionMCPToolsCall,
	} {
		if err := engine.AddRule(&policy.Rule{
			TenantID: "tenant-1", Name: "read allowed MCP items", Effect: policy.EffectAllow,
			Actions: []string{action}, Resources: []string{"server::allowed"},
			Roles:      []string{policy.RoleToolConsumer},
			Conditions: map[string]any{"environment": "production"},
		}); err != nil {
			t.Fatalf("add allow policy: %v", err)
		}
	}
	if err := engine.AddRule(&policy.Rule{
		TenantID: "tenant-1", Name: "deny tool invocation", Effect: policy.EffectDeny,
		Actions: []string{policy.ActionMCPToolsCall}, Resources: []string{"server::denied"},
	}); err != nil {
		t.Fatalf("add deny policy: %v", err)
	}
	handler := NewGatewayHandler(aggregation.NewAggregator(reg, time.Minute), session.NewManager(), "tenant-1")
	handler.SetPolicyEngine(engine)

	tests := []struct {
		method string
		check  func(*testing.T, protocol.Response)
	}{
		{
			method: "tools/list",
			check: func(t *testing.T, response protocol.Response) {
				var result protocol.ListToolsResult
				if err := json.Unmarshal(response.Result, &result); err != nil {
					t.Fatalf("decode tools result: %v", err)
				}
				if len(result.Tools) != 1 || result.Tools[0].Name != "server::allowed" {
					t.Fatalf("visible tools = %+v, want only server::allowed", result.Tools)
				}
			},
		},
		{
			method: "resources/list",
			check: func(t *testing.T, response protocol.Response) {
				var result protocol.ListResourcesResult
				if err := json.Unmarshal(response.Result, &result); err != nil {
					t.Fatalf("decode resources result: %v", err)
				}
				if len(result.Resources) != 1 || result.Resources[0].Name != "server::allowed" {
					t.Fatalf("visible resources = %+v, want only server::allowed", result.Resources)
				}
			},
		},
		{
			method: "prompts/list",
			check: func(t *testing.T, response protocol.Response) {
				var result protocol.ListPromptsResult
				if err := json.Unmarshal(response.Result, &result); err != nil {
					t.Fatalf("decode prompts result: %v", err)
				}
				if len(result.Prompts) != 1 || result.Prompts[0].Name != "server::allowed" {
					t.Fatalf("visible prompts = %+v, want only server::allowed", result.Prompts)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.method, func(t *testing.T) {
			request := &protocol.Request{JSONRPC: "2.0", ID: rawIDForTest(1), Method: test.method}
			response := handler.dispatchMethod(ctx, "tenant-1", request)
			if response.Error != nil {
				t.Fatalf("dispatch %s: %v", test.method, response.Error)
			}
			test.check(t, *response)
		})
	}

	callDenied := &protocol.Request{
		JSONRPC: "2.0", ID: rawIDForTest(2), Method: "tools/call",
		Params: json.RawMessage(`{"name":"server::denied","arguments":{}}`),
	}
	deniedResponse := handler.dispatchMethod(ctx, "tenant-1", callDenied)
	if deniedResponse.Error == nil || deniedResponse.Error.Code != protocol.CodeUnauthorized {
		t.Fatalf("denied invocation response = %+v, want unauthorized error", deniedResponse)
	}

	callAllowed := &protocol.Request{
		JSONRPC: "2.0", ID: rawIDForTest(3), Method: "tools/call",
		Params: json.RawMessage(`{"name":"server::allowed","arguments":{}}`),
	}
	allowedResponse := handler.dispatchMethod(ctx, "tenant-1", callAllowed)
	if allowedResponse.Error != nil || !strings.Contains(string(allowedResponse.Result), "ran") {
		t.Fatalf("authorized invocation response = %+v", allowedResponse)
	}

	crossTenantResponse := handler.dispatchMethod(ctx, "tenant-2", callAllowed)
	if crossTenantResponse.Error == nil || crossTenantResponse.Error.Code != protocol.CodeUnauthorized {
		t.Fatalf("cross-tenant invocation response = %+v, want unauthorized error", crossTenantResponse)
	}
}

func rawIDForTest(id int) *json.RawMessage {
	raw := json.RawMessage(strconv.Itoa(id))
	return &raw
}
