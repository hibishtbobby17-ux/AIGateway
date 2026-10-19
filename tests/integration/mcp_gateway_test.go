package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"project_alpha/internal/mcp/aggregation"
	"project_alpha/internal/mcp/protocol"
	"project_alpha/internal/mcp/registry"
	"project_alpha/internal/mcp/session"
	"project_alpha/internal/mcp/transport"
	"project_alpha/internal/mcp/upstream"
)

func setupTestMCPGateway(t *testing.T) (*transport.GatewayHandler, *registry.MemoryRegistry, *aggregation.Aggregator) {
	reg := registry.NewMemoryRegistry()
	agg := aggregation.NewAggregator(reg, 5*time.Minute)
	sess := session.NewManager()
	handler := transport.NewGatewayHandler(agg, sess, "tenant-test")
	return handler, reg, agg
}

func TestMCPGatewayMultiServerAggregationAndRouting(t *testing.T) {
	ctx := context.Background()
	handler, reg, agg := setupTestMCPGateway(t)

	// 1. Setup Mock Upstream 1: "github"
	mockGitHub := upstream.NewMockClient()
	mockGitHub.AddTool(protocol.Tool{
		Name:        "search_repos",
		Description: "Search GitHub repositories",
		InputSchema: json.RawMessage(`{"type":"object"}`),
	}, func(args json.RawMessage) (*protocol.CallToolResult, error) {
		return &protocol.CallToolResult{
			Content: []protocol.ToolContent{
				{Type: "text", Text: `[{"name":"project_alpha","stars":100}]`},
			},
		}, nil
	})
	mockGitHub.AddTool(protocol.Tool{
		Name:        "health",
		Description: "GitHub health check",
		InputSchema: json.RawMessage(`{}`),
	}, func(args json.RawMessage) (*protocol.CallToolResult, error) {
		return &protocol.CallToolResult{
			Content: []protocol.ToolContent{{Type: "text", Text: "github ok"}},
		}, nil
	})

	err := reg.RegisterServer(ctx, &registry.ServerRegistration{
		ID:              "srv-github",
		TenantID:        "tenant-test",
		Name:            "github",
		NamespacePrefix: "github",
		TimeoutMs:       5000,
		Client:          mockGitHub,
	})
	if err != nil {
		t.Fatalf("failed registering github upstream: %v", err)
	}

	// 2. Setup Mock Upstream 2: "postgres"
	mockPostgres := upstream.NewMockClient()
	mockPostgres.AddTool(protocol.Tool{
		Name:        "query_sql",
		Description: "Execute read-only SQL query",
		InputSchema: json.RawMessage(`{"type":"object"}`),
	}, func(args json.RawMessage) (*protocol.CallToolResult, error) {
		return &protocol.CallToolResult{
			Content: []protocol.ToolContent{
				{Type: "text", Text: `[{"row_count":42}]`},
			},
		}, nil
	})
	// Duplicate name test: Upstream 2 ALSO exposes a tool named "health"
	mockPostgres.AddTool(protocol.Tool{
		Name:        "health",
		Description: "Postgres health check",
		InputSchema: json.RawMessage(`{}`),
	}, func(args json.RawMessage) (*protocol.CallToolResult, error) {
		return &protocol.CallToolResult{
			Content: []protocol.ToolContent{{Type: "text", Text: "postgres ok"}},
		}, nil
	})

	err = reg.RegisterServer(ctx, &registry.ServerRegistration{
		ID:              "srv-postgres",
		TenantID:        "tenant-test",
		Name:            "postgres",
		NamespacePrefix: "postgres",
		TimeoutMs:       5000,
		Client:          mockPostgres,
	})
	if err != nil {
		t.Fatalf("failed registering postgres upstream: %v", err)
	}

	// 3. Test "initialize" JSON-RPC
	initReq := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}`
	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(initReq))
	handler.HandleMessages(rec, httpReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on initialize, got: %d", rec.Code)
	}
	var initResp protocol.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &initResp); err != nil {
		t.Fatalf("failed unmarshaling init response: %v", err)
	}
	if initResp.Error != nil {
		t.Fatalf("unexpected error in init: %v", initResp.Error)
	}

	// 4. Test "tools/list" Aggregation & Disambiguation
	listReq := `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
	rec = httptest.NewRecorder()
	httpReq = httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(listReq))
	handler.HandleMessages(rec, httpReq)

	var listResp protocol.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("failed unmarshaling tools/list response: %v", err)
	}
	if listResp.Error != nil {
		t.Fatalf("unexpected error in tools/list: %v", listResp.Error)
	}

	var listResult protocol.ListToolsResult
	if err := json.Unmarshal(listResp.Result, &listResult); err != nil {
		t.Fatalf("failed unmarshaling ListToolsResult: %v", err)
	}

	// Expecting 4 total tools: github::search_repos, github::health, postgres::query_sql, postgres::health
	if len(listResult.Tools) != 4 {
		t.Fatalf("expected 4 aggregated tools, got: %d", len(listResult.Tools))
	}

	toolNames := make(map[string]bool)
	for _, tool := range listResult.Tools {
		toolNames[tool.Name] = true
	}

	if !toolNames["github::search_repos"] {
		t.Errorf("missing tool github::search_repos")
	}
	if !toolNames["postgres::query_sql"] {
		t.Errorf("missing tool postgres::query_sql")
	}
	if !toolNames["github::health"] || !toolNames["postgres::health"] {
		t.Errorf("duplicate tool name 'health' was not properly disambiguated into github::health and postgres::health")
	}

	// 5. Test "tools/call" Routing to Upstream 1
	callReq1 := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"github::search_repos","arguments":{}}}`
	rec = httptest.NewRecorder()
	httpReq = httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(callReq1))
	handler.HandleMessages(rec, httpReq)

	var callResp1 protocol.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &callResp1); err != nil {
		t.Fatalf("failed unmarshaling call response 1: %v", err)
	}
	if callResp1.Error != nil {
		t.Fatalf("unexpected error calling github::search_repos: %v", callResp1.Error)
	}
	var callResult1 protocol.CallToolResult
	_ = json.Unmarshal(callResp1.Result, &callResult1)
	if len(callResult1.Content) == 0 || !strings.Contains(callResult1.Content[0].Text, "project_alpha") {
		t.Errorf("unexpected tool output from github: %+v", callResult1)
	}

	// 6. Test "tools/call" Routing to Upstream 2
	callReq2 := `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"postgres::query_sql","arguments":{}}}`
	rec = httptest.NewRecorder()
	httpReq = httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(callReq2))
	handler.HandleMessages(rec, httpReq)

	var callResp2 protocol.Response
	if err := json.Unmarshal(rec.Body.Bytes(), &callResp2); err != nil {
		t.Fatalf("failed unmarshaling call response 2: %v", err)
	}
	if callResp2.Error != nil {
		t.Fatalf("unexpected error calling postgres::query_sql: %v", callResp2.Error)
	}
	var callResult2 protocol.CallToolResult
	_ = json.Unmarshal(callResp2.Result, &callResult2)
	if len(callResult2.Content) == 0 || !strings.Contains(callResult2.Content[0].Text, "row_count") {
		t.Errorf("unexpected tool output from postgres: %+v", callResult2)
	}

	// 7. Test Duplicate Name Resolution Routing
	// Calling github::health must return "github ok"
	callReq3 := `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"github::health","arguments":{}}}`
	rec = httptest.NewRecorder()
	handler.HandleMessages(rec, httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(callReq3)))
	var callResp3 protocol.Response
	_ = json.Unmarshal(rec.Body.Bytes(), &callResp3)
	var callResult3 protocol.CallToolResult
	_ = json.Unmarshal(callResp3.Result, &callResult3)
	if callResult3.Content[0].Text != "github ok" {
		t.Errorf("expected 'github ok', got: %s", callResult3.Content[0].Text)
	}

	// Calling postgres::health must return "postgres ok"
	callReq4 := `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"postgres::health","arguments":{}}}`
	rec = httptest.NewRecorder()
	handler.HandleMessages(rec, httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(callReq4)))
	var callResp4 protocol.Response
	_ = json.Unmarshal(rec.Body.Bytes(), &callResp4)
	var callResult4 protocol.CallToolResult
	_ = json.Unmarshal(callResp4.Result, &callResult4)
	if callResult4.Content[0].Text != "postgres ok" {
		t.Errorf("expected 'postgres ok', got: %s", callResult4.Content[0].Text)
	}

	// 8. Test Unqualified Tool Name Rejection
	badCall := `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"unqualified_tool","arguments":{}}}`
	rec = httptest.NewRecorder()
	handler.HandleMessages(rec, httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(badCall)))
	var badResp protocol.Response
	_ = json.Unmarshal(rec.Body.Bytes(), &badResp)
	if badResp.Error == nil || !strings.Contains(badResp.Error.Message, "invalid tool name") {
		t.Errorf("expected error for unqualified tool name, got: %v", badResp)
	}

	// 9. Test Invalid JSON-RPC Parse Error
	rec = httptest.NewRecorder()
	handler.HandleMessages(rec, httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader("invalid-json{")))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for malformed json, got: %d", rec.Code)
	}

	// 10. Test Catalog Cache Invalidation
	agg.InvalidateCache("tenant-test")
}

func TestMCPServerRegistrationDuplicateRejection(t *testing.T) {
	ctx := context.Background()
	reg := registry.NewMemoryRegistry()

	s1 := &registry.ServerRegistration{
		ID:       "srv-1",
		TenantID: "tenant-1",
		Name:     "alpha",
	}
	if err := reg.RegisterServer(ctx, s1); err != nil {
		t.Fatalf("failed registering server 1: %v", err)
	}

	// Attempt registering duplicate name in same tenant
	s2 := &registry.ServerRegistration{
		ID:       "srv-2",
		TenantID: "tenant-1",
		Name:     "alpha",
	}
	if err := reg.RegisterServer(ctx, s2); err == nil {
		t.Fatalf("expected error for duplicate server name in tenant, but got nil")
	}

	// Same name in DIFFERENT tenant should succeed
	s3 := &registry.ServerRegistration{
		ID:       "srv-3",
		TenantID: "tenant-2",
		Name:     "alpha",
	}
	if err := reg.RegisterServer(ctx, s3); err != nil {
		t.Fatalf("failed registering server with same name in different tenant: %v", err)
	}
}

func TestMCPSSEStreamEndpointHandshake(t *testing.T) {
	handler, _, _ := setupTestMCPGateway(t)

	// Create request with cancellable context to simulate client disconnect after receiving initial event
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rec := &flushRecorder{
		ResponseRecorder: httptest.NewRecorder(),
		flushed:          make(chan struct{}, 1),
	}

	req := httptest.NewRequest(http.MethodGet, "/mcp/v1/sse", nil).WithContext(ctx)

	go func() {
		handler.HandleSSE(rec, req)
	}()

	select {
	case <-rec.flushed:
		cancel() // Stop stream after initial handshake
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for SSE endpoint handshake")
	}

	body := rec.Body.String()
	if !strings.Contains(body, "event: endpoint") {
		t.Errorf("expected 'event: endpoint' in SSE output, got: %s", body)
	}
	if !strings.Contains(body, "/mcp/v1/messages?sessionId=") {
		t.Errorf("expected session endpoint URI in SSE output, got: %s", body)
	}
}

type flushRecorder struct {
	*httptest.ResponseRecorder
	flushed chan struct{}
}

func (f *flushRecorder) Flush() {
	select {
	case f.flushed <- struct{}{}:
	default:
	}
}
