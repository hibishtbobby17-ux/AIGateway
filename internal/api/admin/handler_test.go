package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"AIGateway/internal/a2a/protocol"
	a2aregistry "AIGateway/internal/a2a/registry"
	"AIGateway/internal/a2a/tasks"
	"AIGateway/internal/api/admin"
	"AIGateway/internal/audit"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/principal"
	mcpregistry "AIGateway/internal/mcp/registry"
	"AIGateway/internal/observability/model"
	obsstorage "AIGateway/internal/observability/storage"
	"AIGateway/internal/policy"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

func setupTestAdmin(t *testing.T) (*admin.Handler, *storage.SQLTenantRepository, *mcpregistry.SQLRegistry, *a2aregistry.SQLRegistry, tasks.Store, obsstorage.TraceStore, obsstorage.LogStore) {
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening test db: %v", err)
	}

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{
		ID:   "tenant-1",
		Name: "Tenant One",
		Slug: "tenant-one",
	})
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{
		ID:   "tenant-2",
		Name: "Tenant Two",
		Slug: "tenant-two",
	})

	policyRepo, err := policy.NewSQLRepository(db)
	if err != nil {
		t.Fatalf("failed creating policy repo: %v", err)
	}

	mcpReg := mcpregistry.NewSQLRegistry(db)
	a2aReg := a2aregistry.NewSQLRegistry(db)
	tasksStore := tasks.NewSQLStore(db)
	traceStore := obsstorage.NewSQLTraceStore(db)
	logStore := obsstorage.NewSQLLogStore(db)
	recorder := audit.NewSQLRecorder(db)

	handler := admin.NewHandlerWithConfig(admin.Config{
		Recorder:    recorder,
		PolicyRepo:  policyRepo,
		TenantsRepo: tenantsRepo,
		MCPRegistry: mcpReg,
		A2ARegistry: a2aReg,
		TasksStore:  tasksStore,
		TraceStore:  traceStore,
		LogStore:    logStore,
		HTTPClient:  http.DefaultClient,
	})

	return handler, tenantsRepo, mcpReg, a2aReg, tasksStore, traceStore, logStore
}

func TestAdminHandler_MCPServerManagement(t *testing.T) {
	handler, _, _, _, _, _, _ := setupTestAdmin(t)

	caller := principal.Principal{
		Subject:  "operator-1",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	}

	// Spin up a mock upstream MCP server
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer mockUpstream.Close()

	// 1. Create MCP server
	createBody := fmt.Sprintf(`{
		"name": "mock-github",
		"namespace_prefix": "github",
		"transport_type": "SSE",
		"endpoint_url": "%s",
		"timeout_ms": 5000
	}`, mockUpstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/mcp-servers", bytes.NewBufferString(createBody))
	req = req.WithContext(principal.WithContext(req.Context(), caller))
	rr := httptest.NewRecorder()
	handler.HandleMCPServers(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var created mcpregistry.ServerRegistration
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed unmarshaling server: %v", err)
	}
	if created.ID == "" || created.Name != "mock-github" {
		t.Fatalf("unexpected server: %+v", created)
	}

	// 2. List MCP servers
	reqList := httptest.NewRequest(http.MethodGet, "/api/v1/mcp-servers", nil)
	reqList = reqList.WithContext(principal.WithContext(reqList.Context(), caller))
	rrList := httptest.NewRecorder()
	handler.HandleMCPServers(rrList, reqList)

	if rrList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrList.Code)
	}
	var servers []*mcpregistry.ServerRegistration
	_ = json.Unmarshal(rrList.Body.Bytes(), &servers)
	if len(servers) != 1 || servers[0].Name != "mock-github" {
		t.Fatalf("expected 1 server, got %d", len(servers))
	}

	// 3. Test Health Check
	reqHealth := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/mcp-servers/%s/health", created.ID), nil)
	reqHealth = reqHealth.WithContext(principal.WithContext(reqHealth.Context(), caller))
	rrHealth := httptest.NewRecorder()
	handler.HandleMCPServers(rrHealth, reqHealth)

	if rrHealth.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrHealth.Code, rrHealth.Body.String())
	}
	var healthResp map[string]any
	_ = json.Unmarshal(rrHealth.Body.Bytes(), &healthResp)
	if healthResp["health"] != "HEALTHY" {
		t.Fatalf("expected HEALTHY status, got %+v", healthResp)
	}

	// 4. Delete MCP server
	reqDel := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/mcp-servers/%s", created.ID), nil)
	reqDel = reqDel.WithContext(principal.WithContext(reqDel.Context(), caller))
	rrDel := httptest.NewRecorder()
	handler.HandleMCPServers(rrDel, reqDel)

	if rrDel.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for delete, got %d", rrDel.Code)
	}
}

func TestAdminHandler_AgentManagement(t *testing.T) {
	handler, _, _, _, _, _, _ := setupTestAdmin(t)

	caller := principal.Principal{
		Subject:  "operator-1",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	}

	mockAgent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	}))
	defer mockAgent.Close()

	// 1. Create Agent
	agentBody := fmt.Sprintf(`{
		"name": "research-agent",
		"endpoint_url": "%s",
		"agent_card": {
			"name": "research-agent",
			"description": "Performs deep web research",
			"version": "1.0.0",
			"protocol_version": "a2a/v1",
			"capabilities": ["search", "summarize"]
		}
	}`, mockAgent.URL)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents", bytes.NewBufferString(agentBody))
	req = req.WithContext(principal.WithContext(req.Context(), caller))
	rr := httptest.NewRecorder()
	handler.HandleAgents(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var created a2aregistry.Agent
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if created.ID == "" || created.Name != "research-agent" {
		t.Fatalf("unexpected agent: %+v", created)
	}

	// 2. Health check
	reqHealth := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/agents/%s/health", created.ID), nil)
	reqHealth = reqHealth.WithContext(principal.WithContext(reqHealth.Context(), caller))
	rrHealth := httptest.NewRecorder()
	handler.HandleAgents(rrHealth, reqHealth)

	if rrHealth.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrHealth.Code, rrHealth.Body.String())
	}
	var healthResp map[string]any
	_ = json.Unmarshal(rrHealth.Body.Bytes(), &healthResp)
	if healthResp["health"] != "HEALTHY" {
		t.Fatalf("expected HEALTHY status, got %+v", healthResp)
	}

	// 3. Delete Agent
	reqDel := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/agents/%s", created.ID), nil)
	reqDel = reqDel.WithContext(principal.WithContext(reqDel.Context(), caller))
	rrDel := httptest.NewRecorder()
	handler.HandleAgents(rrDel, reqDel)

	if rrDel.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrDel.Code)
	}
}

func TestAdminHandler_ConfiguredAndObservedTopology(t *testing.T) {
	handler, _, mcpReg, a2aReg, _, traceStore, _ := setupTestAdmin(t)
	ctx := context.Background()

	caller := principal.Principal{
		Subject:  "operator-1",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	}

	// 1. Register MCP Server & Agent
	_ = mcpReg.RegisterServer(ctx, &mcpregistry.ServerRegistration{
		TenantID:        "tenant-1",
		Name:            "github",
		NamespacePrefix: "github",
		TransportType:   "SSE",
		EndpointURL:     "http://localhost:8081",
	})
	_ = a2aReg.RegisterAgent(ctx, &a2aregistry.Agent{
		TenantID:    "tenant-1",
		Name:        "researcher",
		EndpointURL: "http://localhost:8082",
		AgentCard: protocol.AgentCard{
			Name:            "researcher",
			Version:         "1.0.0",
			ProtocolVersion: "a2a/v1",
			Capabilities:    []string{"analysis"},
		},
	})

	// 2. Query Configured Topology
	reqConf := httptest.NewRequest(http.MethodGet, "/api/v1/topology/configured", nil)
	reqConf = reqConf.WithContext(principal.WithContext(reqConf.Context(), caller))
	rrConf := httptest.NewRecorder()
	handler.HandleGetConfiguredTopology(rrConf, reqConf)

	if rrConf.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrConf.Code, rrConf.Body.String())
	}
	var conf model.ConfiguredTopology
	if err := json.Unmarshal(rrConf.Body.Bytes(), &conf); err != nil {
		t.Fatalf("failed unmarshaling configured topology: %v", err)
	}
	if len(conf.Nodes) != 3 { // Gateway, github, researcher
		t.Fatalf("expected 3 nodes, got %d", len(conf.Nodes))
	}
	if len(conf.Edges) != 2 {
		t.Fatalf("expected 2 configured edges, got %d", len(conf.Edges))
	}

	// 3. Ingest Spans to test Observed Topology
	now := time.Now().UTC()
	spans := []*model.Span{
		{
			SpanID:     "span-1",
			TraceID:    "trace-abc",
			TenantID:   "tenant-1",
			Name:       "mcp.call_tool",
			Kind:       model.SpanKindClient,
			StartTime:  now.Add(-10 * time.Minute),
			EndTime:    now.Add(-10 * time.Minute).Add(15 * time.Millisecond),
			DurationMs: 15.0,
			StatusCode: model.StatusCodeOk,
			Attributes: map[string]any{
				"mcp.server_name": "github",
				"mcp.tool_name":   "create_issue",
			},
		},
		{
			SpanID:     "span-2",
			TraceID:    "trace-def",
			TenantID:   "tenant-1",
			Name:       "a2a.send_task",
			Kind:       model.SpanKindClient,
			StartTime:  now.Add(-5 * time.Minute),
			EndTime:    now.Add(-5 * time.Minute).Add(45 * time.Millisecond),
			DurationMs: 45.0,
			StatusCode: model.StatusCodeOk,
			Attributes: map[string]any{
				"a2a.agent_name": "researcher",
			},
		},
	}
	if err := traceStore.StoreSpans(ctx, spans); err != nil {
		t.Fatalf("failed storing spans: %v", err)
	}

	// 4. Query Observed Topology
	reqObs := httptest.NewRequest(http.MethodGet, "/api/v1/topology/observed?duration=1h", nil)
	reqObs = reqObs.WithContext(principal.WithContext(reqObs.Context(), caller))
	rrObs := httptest.NewRecorder()
	handler.HandleGetObservedTopology(rrObs, reqObs)

	if rrObs.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrObs.Code)
	}
	var obs model.ObservedTopology
	if err := json.Unmarshal(rrObs.Body.Bytes(), &obs); err != nil {
		t.Fatalf("failed unmarshaling observed topology: %v", err)
	}
	if obs.TotalCalls != 2 {
		t.Fatalf("expected 2 total calls, got %d", obs.TotalCalls)
	}
	if len(obs.Edges) != 2 {
		t.Fatalf("expected 2 observed interaction edges, got %d", len(obs.Edges))
	}
}

func TestAdminHandler_PolicyDryRun(t *testing.T) {
	handler, _, _, _, _, _, _ := setupTestAdmin(t)

	caller := principal.Principal{
		Subject:  "operator-1",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	}

	// 1. Create a policy: allow developer role to execute github::* tools
	policyReqBody := `{
		"id": "policy-dev-github",
		"name": "Dev Github Policy",
		"effect": "ALLOW",
		"actions": ["mcp:tools:call"],
		"resources": ["github::*"],
		"roles": ["developer"]
	}`
	reqCreate := httptest.NewRequest(http.MethodPost, "/api/v1/policies", bytes.NewBufferString(policyReqBody))
	reqCreate = reqCreate.WithContext(principal.WithContext(reqCreate.Context(), caller))
	rrCreate := httptest.NewRecorder()
	handler.HandlePolicies(rrCreate, reqCreate)
	if rrCreate.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", rrCreate.Code)
	}

	// 2. Dry run with authorized request
	dryRunAllow := `{
		"subject": "alice",
		"roles": ["developer"],
		"action": "mcp:tools:call",
		"resource": "github::create_issue",
		"scopes": ["mcp:tools:call"]
	}`
	reqDryAllow := httptest.NewRequest(http.MethodPost, "/api/v1/policies/dry-run", bytes.NewBufferString(dryRunAllow))
	reqDryAllow = reqDryAllow.WithContext(principal.WithContext(reqDryAllow.Context(), caller))
	rrDryAllow := httptest.NewRecorder()
	handler.HandlePolicies(rrDryAllow, reqDryAllow)

	if rrDryAllow.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rrDryAllow.Code, rrDryAllow.Body.String())
	}
	var dryRespAllow admin.DryRunResponse
	_ = json.Unmarshal(rrDryAllow.Body.Bytes(), &dryRespAllow)
	if dryRespAllow.Decision != "ALLOW" {
		t.Fatalf("expected ALLOW decision, got %+v", dryRespAllow)
	}

	// 3. Dry run with unauthorized request
	dryRunDeny := `{
		"subject": "bob",
		"roles": ["guest"],
		"action": "mcp:tools:call",
		"resource": "github::create_issue"
	}`
	reqDryDeny := httptest.NewRequest(http.MethodPost, "/api/v1/policies/dry-run", bytes.NewBufferString(dryRunDeny))
	reqDryDeny = reqDryDeny.WithContext(principal.WithContext(reqDryDeny.Context(), caller))
	rrDryDeny := httptest.NewRecorder()
	handler.HandlePolicies(rrDryDeny, reqDryDeny)

	var dryRespDeny admin.DryRunResponse
	_ = json.Unmarshal(rrDryDeny.Body.Bytes(), &dryRespDeny)
	if dryRespDeny.Decision != "DENY" {
		t.Fatalf("expected DENY decision, got %+v", dryRespDeny)
	}
}

func TestAdminHandler_TenantIsolation(t *testing.T) {
	handler, _, mcpReg, _, _, traceStore, _ := setupTestAdmin(t)
	ctx := context.Background()

	// Tenant 1 registers a server and span
	_ = mcpReg.RegisterServer(ctx, &mcpregistry.ServerRegistration{
		TenantID:        "tenant-1",
		Name:            "tenant-1-server",
		NamespacePrefix: "t1",
		TransportType:   "SSE",
		EndpointURL:     "http://localhost:8081",
	})
	_ = traceStore.StoreSpans(ctx, []*model.Span{
		{
			SpanID:     "span-t1",
			TraceID:    "trace-t1",
			TenantID:   "tenant-1",
			Name:       "mcp.call_tool",
			StartTime:  time.Now(),
			EndTime:    time.Now().Add(10 * time.Millisecond),
			DurationMs: 10.0,
			StatusCode: model.StatusCodeOk,
		},
	})

	// Tenant 2 caller
	callerT2 := principal.Principal{
		Subject:  "admin-t2",
		TenantID: "tenant-2",
		Roles:    []string{"tenant-admin"},
	}

	// Tenant 2 queries servers
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp-servers", nil)
	req = req.WithContext(principal.WithContext(req.Context(), callerT2))
	rr := httptest.NewRecorder()
	handler.HandleMCPServers(rr, req)

	var servers []*mcpregistry.ServerRegistration
	_ = json.Unmarshal(rr.Body.Bytes(), &servers)
	if len(servers) != 0 {
		t.Fatalf("tenant isolation breach: tenant-2 saw tenant-1 servers: %+v", servers)
	}

	// Tenant 2 queries traces
	reqTraces := httptest.NewRequest(http.MethodGet, "/api/v1/traces", nil)
	reqTraces = reqTraces.WithContext(principal.WithContext(reqTraces.Context(), callerT2))
	rrTraces := httptest.NewRecorder()
	handler.HandleTraces(rrTraces, reqTraces)

	var summaries []*model.TraceSummary
	_ = json.Unmarshal(rrTraces.Body.Bytes(), &summaries)
	if len(summaries) != 0 {
		t.Fatalf("tenant isolation breach: tenant-2 saw tenant-1 traces: %+v", summaries)
	}
}

func TestAdminHandler_MCPOAuth2RegistrationAndHealth(t *testing.T) {
	handler, _, _, _, _, _, _ := setupTestAdmin(t)

	caller := principal.Principal{
		Subject:  "operator-1",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	}

	// Spin up mock OAuth2 token provider server
	mockTokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "mock-m2m-token-123",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer mockTokenServer.Close()

	// 1. Test test-oauth endpoint
	probeBody := fmt.Sprintf(`{
		"token_endpoint": "%s",
		"client_id": "test-client",
		"client_secret": "test-secret",
		"scopes": "read write"
	}`, mockTokenServer.URL)
	reqProbe := httptest.NewRequest(http.MethodPost, "/api/v1/mcp-servers/test-oauth", bytes.NewBufferString(probeBody))
	reqProbe = reqProbe.WithContext(principal.WithContext(reqProbe.Context(), caller))
	rrProbe := httptest.NewRecorder()
	handler.HandleMCPServers(rrProbe, reqProbe)

	if rrProbe.Code != http.StatusOK {
		t.Fatalf("expected 200 for test-oauth, got %d: %s", rrProbe.Code, rrProbe.Body.String())
	}

	// 2. Register MCP server with OAuth2 client credentials
	createBody := fmt.Sprintf(`{
		"name": "oauth-jira-tools",
		"namespace_prefix": "jira",
		"transport_type": "SSE",
		"endpoint_url": "%s/sse",
		"auth_config": {
			"type": "OAUTH2_CLIENT_CREDENTIALS",
			"token_endpoint": "%s",
			"client_id": "jira-m2m-client",
			"client_secret": "jira-m2m-secret",
			"scopes": "tools:call"
		}
	}`, mockTokenServer.URL, mockTokenServer.URL)

	reqCreate := httptest.NewRequest(http.MethodPost, "/api/v1/mcp-servers", bytes.NewBufferString(createBody))
	reqCreate = reqCreate.WithContext(principal.WithContext(reqCreate.Context(), caller))
	rrCreate := httptest.NewRecorder()
	handler.HandleMCPServers(rrCreate, reqCreate)

	if rrCreate.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for oauth mcp server, got %d: %s", rrCreate.Code, rrCreate.Body.String())
	}

	var created mcpregistry.ServerRegistration
	_ = json.Unmarshal(rrCreate.Body.Bytes(), &created)
	if created.AuthConfig.ClientSecret != "••••••••" {
		t.Fatalf("expected client_secret to be sanitized/masked in response, got: %s", created.AuthConfig.ClientSecret)
	}

	// 3. Probe Health: Should resolve OAuth token and hit mock endpoint
	reqHealth := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/mcp-servers/%s/health", created.ID), nil)
	reqHealth = reqHealth.WithContext(principal.WithContext(reqHealth.Context(), caller))
	rrHealth := httptest.NewRecorder()
	handler.HandleMCPServers(rrHealth, reqHealth)

	if rrHealth.Code != http.StatusOK {
		t.Fatalf("expected 200 for health probe, got %d: %s", rrHealth.Code, rrHealth.Body.String())
	}
}

