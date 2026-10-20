package integration_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	a2aprotocol "project_alpha/internal/a2a/protocol"
	a2aregistry "project_alpha/internal/a2a/registry"
	a2atasks "project_alpha/internal/a2a/tasks"
	"project_alpha/internal/api/admin"
	"project_alpha/internal/api/health"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/config"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/tokens"
	mcpregistry "project_alpha/internal/mcp/registry"
	"project_alpha/internal/observability/model"
	obsstorage "project_alpha/internal/observability/storage"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
	"project_alpha/internal/tenants"
	"project_alpha/migrations"
	"project_alpha/web"
)

type consoleAdminCluster struct {
	server       *httptest.Server
	db           *sql.DB
	keyManager   *keys.Manager
	policyEngine *policy.Engine
	policyRepo   *policy.SQLRepository
	auditRec     audit.Recorder
	mcpReg       mcpregistry.Registry
	a2aReg       a2aregistry.Registry
	tasksStore   a2atasks.Store
	traceStore   obsstorage.TraceStore
	logStore     obsstorage.LogStore
}

func setupConsoleAdminCluster(t *testing.T) *consoleAdminCluster {
	t.Helper()
	ctx := context.Background()

	// 1. In-memory DB with all migrations
	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-a", Name: "Tenant Alpha", Slug: "tenant-a"})
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-b", Name: "Tenant Beta", Slug: "tenant-b"})

	keyManager, _ := keys.NewManager()
	revocationStore := tokens.NewRevocationManager()
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://gateway.example.com", "ai-gateway")

	policyRepo, err := policy.NewSQLRepository(db)
	if err != nil {
		t.Fatalf("failed creating policy repo: %v", err)
	}
	policyEngine := policy.NewEngine()

	auditRec := audit.NewSQLRecorder(db)
	mcpReg := mcpregistry.NewSQLRegistry(db)
	a2aReg := a2aregistry.NewSQLRegistry(db)
	tasksStore := a2atasks.NewSQLStore(db)
	traceStore := obsstorage.NewSQLTraceStore(db)
	logStore := obsstorage.NewSQLLogStore(db)

	adminHandler := admin.NewHandlerWithConfig(admin.Config{
		Recorder:     auditRec,
		PolicyRepo:   policyRepo,
		TenantsRepo:  tenantsRepo,
		MCPRegistry:  mcpReg,
		A2ARegistry:  a2aReg,
		TasksStore:   tasksStore,
		TraceStore:   traceStore,
		LogStore:     logStore,
		PolicyEngine: policyEngine,
	})

	healthHandler := health.NewHandler()
	healthHandler.SetReady(true)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler.LivenessHandler)
	mux.HandleFunc("/readyz", healthHandler.ReadinessHandler)

	adminMux := http.NewServeMux()
	adminHandler.RegisterRoutes(adminMux)

	adminChain := middleware.AuthMiddleware(verifier, policyEngine)(
		middleware.RequireRoles(auditRec, "platform-admin", "tenant-admin", "auditor")(adminMux),
	)

	mux.Handle("/api/v1/", adminChain)

	// Embedded console frontend
	consoleHandler := web.Handler()
	mux.Handle("/console/", http.StripPrefix("/console", consoleHandler))
	mux.HandleFunc("/console", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/console/", http.StatusPermanentRedirect)
	})
	mux.Handle("/", consoleHandler)

	server := httptest.NewServer(mux)
	t.Cleanup(func() { server.Close() })

	return &consoleAdminCluster{
		server:       server,
		db:           db,
		keyManager:   keyManager,
		policyEngine: policyEngine,
		policyRepo:   policyRepo,
		auditRec:     auditRec,
		mcpReg:       mcpReg,
		a2aReg:       a2aReg,
		tasksStore:   tasksStore,
		traceStore:   traceStore,
		logStore:     logStore,
	}
}

func (c *consoleAdminCluster) mintToken(t *testing.T, tenantID, subject string, roles []string) string {
	t.Helper()
	activeKey, err := c.keyManager.GetActiveKey()
	if err != nil {
		t.Fatalf("failed getting active key: %v", err)
	}
	now := time.Now().UTC()
	claims := &tokens.Claims{
		Issuer:    "https://gateway.example.com",
		Subject:   subject,
		Audience:  "ai-gateway",
		TenantID:  tenantID,
		Roles:     roles,
		Scopes:    []string{"admin:read", "admin:write"},
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(time.Hour).Unix(),
		TokenID:   "token-" + subject,
	}
	tok, err := tokens.Sign(claims, activeKey)
	if err != nil {
		t.Fatalf("sign token failed: %v", err)
	}
	return tok
}

func TestConsoleAndAdmin_EndToEnd(t *testing.T) {
	cluster := setupConsoleAdminCluster(t)
	client := &http.Client{Timeout: 5 * time.Second}

	tokenAdminA := cluster.mintToken(t, "tenant-a", "admin-alice", []string{"tenant-admin"})
	tokenAdminB := cluster.mintToken(t, "tenant-b", "admin-bob", []string{"tenant-admin"})
	tokenUserA := cluster.mintToken(t, "tenant-a", "user-charlie", []string{"unprivileged-user"})

	// =========================================================================
	// 1. Console Static Asset Serving
	// =========================================================================
	t.Run("Console Assets Served", func(t *testing.T) {
		// Root "/"
		resp, err := client.Get(cluster.server.URL + "/")
		if err != nil {
			t.Fatalf("GET / failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for /, got %d", resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(body), "AI Gateway & Observability Platform Console") || !strings.Contains(string(body), `id="root"`) {
			t.Errorf("expected HTML root in index.html, got: %s", string(body[:min(len(body), 200)]))
		}

		// "/console.css"
		respCSS, err := client.Get(cluster.server.URL + "/console.css")
		if err != nil {
			t.Fatalf("GET /console.css failed: %v", err)
		}
		defer respCSS.Body.Close()
		if respCSS.StatusCode != http.StatusOK {
			t.Errorf("expected 200 for console.css, got %d", respCSS.StatusCode)
		}

		// "/console.js"
		respJS, err := client.Get(cluster.server.URL + "/console.js")
		if err != nil {
			t.Fatalf("GET /console.js failed: %v", err)
		}
		defer respJS.Body.Close()
		if respJS.StatusCode != http.StatusOK {
			t.Errorf("expected 200 for console.js, got %d", respJS.StatusCode)
		}
		jsBody, _ := io.ReadAll(respJS.Body)
		if !strings.Contains(string(jsBody), "AI Gateway & Observability Platform - Console Application Bundle") {
			t.Errorf("expected bundle banner in console.js")
		}

		// "/console/"
		respConsole, err := client.Get(cluster.server.URL + "/console/")
		if err != nil {
			t.Fatalf("GET /console/ failed: %v", err)
		}
		defer respConsole.Body.Close()
		if respConsole.StatusCode != http.StatusOK {
			t.Errorf("expected 200 for /console/, got %d", respConsole.StatusCode)
		}
	})

	// =========================================================================
	// 2. Authentication & Role Enforcement
	// =========================================================================
	t.Run("Auth & Role Guards", func(t *testing.T) {
		// Unauthenticated
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/mcp-servers", nil)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/mcp-servers unauth failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized for missing token, got %d", resp.StatusCode)
		}

		// Non-admin role (unprivileged user)
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/mcp-servers", nil)
		req.Header.Set("Authorization", "Bearer "+tokenUserA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/mcp-servers unprivileged failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for non-admin role, got %d", resp.StatusCode)
		}

		// Cross-tenant mismatch (Token is tenant-a, header specifies tenant-b)
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/mcp-servers", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		req.Header.Set("X-Tenant-ID", "tenant-b")
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/mcp-servers cross-tenant failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for cross-tenant mismatch, got %d", resp.StatusCode)
		}
	})

	// =========================================================================
	// 3. MCP Server Management & Health Probing
	// =========================================================================
	var mcpServerID string
	// Mock upstream server for health probe
	mockMCPUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	t.Cleanup(func() { mockMCPUpstream.Close() })

	t.Run("MCP Server CRUD and Health Probe", func(t *testing.T) {
		// Register server for tenant-a
		createPayload := map[string]any{
			"name":             "filesystem-tools",
			"namespace_prefix": "fs",
			"endpoint_url":     mockMCPUpstream.URL + "/mcp",
			"transport_type":   "SSE",
			"timeout_ms":       3000,
		}
		bodyBytes, _ := json.Marshal(createPayload)

		req, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/api/v1/mcp-servers", bytes.NewReader(bodyBytes))
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("POST /api/v1/mcp-servers failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 201 Created, got %d: %s", resp.StatusCode, string(body))
		}
		var createdServer mcpregistry.ServerRegistration
		_ = json.NewDecoder(resp.Body).Decode(&createdServer)
		if createdServer.ID == "" || createdServer.Name != "filesystem-tools" {
			t.Fatalf("invalid server created response: %+v", createdServer)
		}
		mcpServerID = createdServer.ID

		// List servers for tenant-a
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/mcp-servers", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/mcp-servers failed: %v", err)
		}
		defer resp.Body.Close()
		var servers []*mcpregistry.ServerRegistration
		_ = json.NewDecoder(resp.Body).Decode(&servers)
		if len(servers) != 1 || servers[0].ID != mcpServerID {
			t.Errorf("expected 1 server for tenant-a, got %d", len(servers))
		}

		// Multi-tenant check: tenant-b sees 0 servers
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/mcp-servers", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminB)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/mcp-servers tenant-b failed: %v", err)
		}
		defer resp.Body.Close()
		var serversB []*mcpregistry.ServerRegistration
		_ = json.NewDecoder(resp.Body).Decode(&serversB)
		if len(serversB) != 0 {
			t.Errorf("expected 0 servers for tenant-b, got %d", len(serversB))
		}

		// Probing health for tenant-a's server
		req, _ = http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/mcp-servers/%s/health", cluster.server.URL, mcpServerID), nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("POST /api/v1/mcp-servers/{id}/health failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 200 OK for health probe, got %d: %s", resp.StatusCode, string(body))
		}
		var healthResp map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&healthResp)
		if healthResp["health_status"] != "HEALTHY" {
			t.Errorf("expected health_status HEALTHY, got %v", healthResp["health_status"])
		}

		// Update server
		updatePayload := map[string]any{
			"name":             "filesystem-tools-v2",
			"namespace_prefix": "fs2",
			"endpoint_url":     mockMCPUpstream.URL + "/mcp",
			"transport_type":   "SSE",
		}
		updateBytes, _ := json.Marshal(updatePayload)
		req, _ = http.NewRequest(http.MethodPut, fmt.Sprintf("%s/api/v1/mcp-servers/%s", cluster.server.URL, mcpServerID), bytes.NewReader(updateBytes))
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		req.Header.Set("Content-Type", "application/json")
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("PUT /api/v1/mcp-servers/{id} failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200 OK for update, got %d", resp.StatusCode)
		}
	})

	// =========================================================================
	// 4. A2A Agent Management & Health Probing
	// =========================================================================
	var agentID string
	mockAgentUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"online"}`))
	}))
	t.Cleanup(func() { mockAgentUpstream.Close() })

	t.Run("A2A Agent CRUD and Health Probe", func(t *testing.T) {
		createAgentPayload := map[string]any{
			"name":         "researcher-agent",
			"endpoint_url": mockAgentUpstream.URL + "/a2a",
			"agent_card": map[string]any{
				"name":             "Researcher Agent",
				"description":      "Deep search and summarization",
				"version":          "1.0.0",
				"protocol_version": "0.3.0",
				"capabilities":     []string{"search", "summarize"},
			},
			"auth_type": "NONE",
		}
		agentBytes, _ := json.Marshal(createAgentPayload)

		req, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/api/v1/agents", bytes.NewReader(agentBytes))
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("POST /api/v1/agents failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 201 Created for agent, got %d: %s", resp.StatusCode, string(body))
		}
		var createdAgent a2aregistry.Agent
		_ = json.NewDecoder(resp.Body).Decode(&createdAgent)
		if createdAgent.ID == "" || createdAgent.Name != "researcher-agent" {
			t.Fatalf("invalid agent returned: %+v", createdAgent)
		}
		agentID = createdAgent.ID

		// List agents
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/agents", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/agents failed: %v", err)
		}
		defer resp.Body.Close()
		var agents []*a2aregistry.Agent
		_ = json.NewDecoder(resp.Body).Decode(&agents)
		if len(agents) != 1 || agents[0].ID != agentID {
			t.Errorf("expected 1 agent for tenant-a, got %d", len(agents))
		}

		// Multi-tenant check: tenant-b sees 0 agents
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/agents", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminB)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/agents tenant-b failed: %v", err)
		}
		defer resp.Body.Close()
		var agentsB []*a2aregistry.Agent
		_ = json.NewDecoder(resp.Body).Decode(&agentsB)
		if len(agentsB) != 0 {
			t.Errorf("expected 0 agents for tenant-b, got %d", len(agentsB))
		}

		// Probe agent health
		req, _ = http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/v1/agents/%s/health", cluster.server.URL, agentID), nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("POST /api/v1/agents/{id}/health failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 200 OK for agent health probe, got %d: %s", resp.StatusCode, string(body))
		}
		var healthResp map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&healthResp)
		if healthResp["health_status"] != "HEALTHY" {
			t.Errorf("expected agent health HEALTHY, got %v", healthResp["health_status"])
		}
	})

	// =========================================================================
	// 5. Configured Topology Endpoint
	// =========================================================================
	t.Run("Configured Topology", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/topology/configured", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/topology/configured failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", resp.StatusCode)
		}

		var topo model.ConfiguredTopology
		_ = json.NewDecoder(resp.Body).Decode(&topo)

		// Must contain gateway, 1 MCP server, 1 A2A agent
		if len(topo.Nodes) != 3 {
			t.Errorf("expected 3 topology nodes (gateway, mcp, a2a), got %d", len(topo.Nodes))
		}
		if len(topo.Edges) != 2 {
			t.Errorf("expected 2 edges connecting gateway, got %d", len(topo.Edges))
		}

		// Tenant B configured topology should only have the gateway node
		reqB, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/topology/configured", nil)
		reqB.Header.Set("Authorization", "Bearer "+tokenAdminB)
		respB, err := client.Do(reqB)
		if err != nil {
			t.Fatalf("GET /api/v1/topology/configured tenant-b failed: %v", err)
		}
		defer respB.Body.Close()
		var topoB model.ConfiguredTopology
		_ = json.NewDecoder(respB.Body).Decode(&topoB)
		if len(topoB.Nodes) != 1 {
			t.Errorf("expected 1 gateway node for tenant-b, got %d", len(topoB.Nodes))
		}
	})

	// =========================================================================
	// 6. Observability: Spans, Observed Topology, Waterfall Traces
	// =========================================================================
	t.Run("Observed Topology, Traces & Logs", func(t *testing.T) {
		ctx := context.Background()
		now := time.Now().UTC()

		// Seed spans for tenant-a
		traceIDA := "trace-alpha-001"
		spans := []*model.Span{
			{
				SpanID:     "span-root-1",
				TraceID:    traceIDA,
				TenantID:   "tenant-a",
				Name:       "gateway.http.request",
				Kind:       "SERVER",
				StartTime:  now.Add(-10 * time.Minute),
				EndTime:    now.Add(-10*time.Minute + 120*time.Millisecond),
				DurationMs: 120,
				StatusCode: "OK",
				Attributes: map[string]any{
					"http.route": "/a2a/v1/tasks",
				},
			},
			{
				SpanID:       "span-child-1",
				TraceID:      traceIDA,
				ParentSpanID: "span-root-1",
				TenantID:     "tenant-a",
				Name:         "mcp.tool_call",
				Kind:         "CLIENT",
				StartTime:    now.Add(-10*time.Minute + 10*time.Millisecond),
				EndTime:      now.Add(-10*time.Minute + 50*time.Millisecond),
				DurationMs:   40,
				StatusCode:   "OK",
				Attributes: map[string]any{
					"mcp.server_id": mcpServerID,
					"mcp.tool_name": "filesystem-read",
				},
			},
			{
				SpanID:       "span-child-2",
				TraceID:      traceIDA,
				ParentSpanID: "span-root-1",
				TenantID:     "tenant-a",
				Name:         "a2a.task_dispatch",
				Kind:         "CLIENT",
				StartTime:    now.Add(-10*time.Minute + 55*time.Millisecond),
				EndTime:      now.Add(-10*time.Minute + 115*time.Millisecond),
				DurationMs:   60,
				StatusCode:   "ERROR",
				Attributes: map[string]any{
					"a2a.agent_id": agentID,
				},
			},
		}
		if err := cluster.traceStore.StoreSpans(ctx, spans); err != nil {
			t.Fatalf("failed storing telemetry spans: %v", err)
		}

		// Seed structured logs
		logs := []*model.LogRecord{
			{
				ID:        "log-1",
				TenantID:  "tenant-a",
				TraceID:   traceIDA,
				SpanID:    "span-child-2",
				Severity:  "ERROR",
				Message:   "upstream agent connection timeout during dispatch",
				Timestamp: now.Add(-10 * time.Minute),
			},
			{
				ID:        "log-2",
				TenantID:  "tenant-a",
				TraceID:   traceIDA,
				SpanID:    "span-child-1",
				Severity:  "INFO",
				Message:   "filesystem tool invocation completed successfully",
				Timestamp: now.Add(-10 * time.Minute),
			},
		}
		if err := cluster.logStore.StoreLogs(ctx, logs); err != nil {
			t.Fatalf("failed storing logs: %v", err)
		}

		// Test GET /api/v1/topology/observed
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/topology/observed?duration=1h", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/topology/observed failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for observed topology, got %d", resp.StatusCode)
		}
		var obsTopo model.ObservedTopology
		_ = json.NewDecoder(resp.Body).Decode(&obsTopo)
		if len(obsTopo.Nodes) < 2 {
			t.Errorf("expected at least 2 observed nodes, got %d", len(obsTopo.Nodes))
		}
		if len(obsTopo.Edges) < 2 {
			t.Errorf("expected at least 2 observed edges, got %d", len(obsTopo.Edges))
		}

		// Test GET /api/v1/traces (list summaries)
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/traces", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/traces failed: %v", err)
		}
		defer resp.Body.Close()
		var traceSummaries []*model.TraceSummary
		_ = json.NewDecoder(resp.Body).Decode(&traceSummaries)
		if len(traceSummaries) != 1 || traceSummaries[0].TraceID != traceIDA {
			t.Errorf("expected 1 trace summary for %s, got %d", traceIDA, len(traceSummaries))
		}

		// Test GET /api/v1/traces/{id} (waterfall span list)
		req, _ = http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/traces/%s", cluster.server.URL, traceIDA), nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/traces/{id} failed: %v", err)
		}
		var waterfall struct {
			TraceID   string        `json:"trace_id"`
			SpanCount int           `json:"span_count"`
			Spans     []*model.Span `json:"spans"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&waterfall)
		if len(waterfall.Spans) != 3 {
			t.Errorf("expected 3 spans in waterfall for %s, got %d", traceIDA, len(waterfall.Spans))
		}

		// Test GET /api/v1/logs with correlation and query filter
		req, _ = http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/logs?trace_id=%s&severity=ERROR", cluster.server.URL, traceIDA), nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/logs failed: %v", err)
		}
		defer resp.Body.Close()
		var queriedLogs []*model.LogRecord
		_ = json.NewDecoder(resp.Body).Decode(&queriedLogs)
		if len(queriedLogs) != 1 || queriedLogs[0].Severity != "ERROR" {
			t.Errorf("expected 1 ERROR log record correlated with trace, got %d", len(queriedLogs))
		}

		// Test GET /api/v1/metrics/summary
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/metrics/summary?duration=1h", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/metrics/summary failed: %v", err)
		}
		defer resp.Body.Close()
		var metricsSum model.MetricsSummary
		_ = json.NewDecoder(resp.Body).Decode(&metricsSum)
		if metricsSum.TotalRequests != 3 {
			t.Errorf("expected 3 total requests in metrics summary, got %d", metricsSum.TotalRequests)
		}

		// Test GET /api/v1/mcp/invocations
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/mcp/invocations", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/mcp/invocations failed: %v", err)
		}
		var toolInvocations []admin.MCPInvocationSummary
		_ = json.NewDecoder(resp.Body).Decode(&toolInvocations)
		if len(toolInvocations) != 1 || toolInvocations[0].ToolName != "filesystem-read" {
			t.Errorf("expected 1 tool invocation for filesystem-read, got %+v", toolInvocations)
		}
	})

	// =========================================================================
	// 7. A2A Tasks & Invocations Endpoint
	// =========================================================================
	t.Run("A2A Tasks and Events", func(t *testing.T) {
		ctx := context.Background()
		task, err := cluster.tasksStore.CreateTask(ctx, &a2aprotocol.Task{
			TenantID:       "tenant-a",
			TargetAgentID:  agentID,
			CallerClientID: "client-system",
			Status:         "RUNNING",
			InputPayload:   []byte(`{"prompt":"hello world"}`),
		})
		if err != nil {
			t.Fatalf("failed creating task: %v", err)
		}

		// Append event
		_ = cluster.tasksStore.AppendEvent(ctx, &a2aprotocol.TaskEvent{
			TenantID:  "tenant-a",
			TaskID:    task.ID,
			EventType: "PROGRESS",
			Payload:   []byte(`{"progress":50}`),
		})

		// List tasks
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/a2a/tasks", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/a2a/tasks failed: %v", err)
		}
		defer resp.Body.Close()
		var taskList []*a2aprotocol.Task
		_ = json.NewDecoder(resp.Body).Decode(&taskList)
		if len(taskList) != 1 || taskList[0].ID != task.ID {
			t.Errorf("expected 1 task in list, got %d", len(taskList))
		}

		// Get task by ID (includes events)
		req, _ = http.NewRequest(http.MethodGet, fmt.Sprintf("%s/api/v1/a2a/tasks/%s", cluster.server.URL, task.ID), nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/a2a/tasks/{id} failed: %v", err)
		}
		defer resp.Body.Close()
		var taskDetail struct {
			Task   *a2aprotocol.Task       `json:"task"`
			Events []*a2aprotocol.TaskEvent `json:"events"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&taskDetail)
		if taskDetail.Task == nil || len(taskDetail.Events) != 2 {
			t.Errorf("expected task with 2 events (status + progress), got task=%v events=%d", taskDetail.Task != nil, len(taskDetail.Events))
		}
	})

	// =========================================================================
	// 8. Policy Management & Dry-Run Evaluation
	// =========================================================================
	t.Run("Policy Management and Dry-Run", func(t *testing.T) {
		// Create a policy rule
		createRulePayload := map[string]any{
			"name":      "deny-shell-exec",
			"effect":    "DENY",
			"actions":   []string{"mcp:tools:execute"},
			"resources": []string{"tools:shell:*"},
			"roles":     []string{"*"},
			"priority":  100,
		}
		bodyBytes, _ := json.Marshal(createRulePayload)

		req, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/api/v1/policies", bytes.NewReader(bodyBytes))
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("POST /api/v1/policies failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 201 Created for policy, got %d: %s", resp.StatusCode, string(body))
		}
		var createdRule policy.Rule
		_ = json.NewDecoder(resp.Body).Decode(&createdRule)

		// List policies
		req, _ = http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/policies", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/policies failed: %v", err)
		}
		defer resp.Body.Close()
		var rules []*policy.Rule
		_ = json.NewDecoder(resp.Body).Decode(&rules)
		if len(rules) != 1 || rules[0].Name != "deny-shell-exec" {
			t.Errorf("expected 1 policy rule, got %d", len(rules))
		}

		// Dry-Run Simulation: Test evaluating denied action
		dryPayload := map[string]any{
			"subject":  "agent-guest",
			"action":   "mcp:tools:execute",
			"resource": "tools:shell:bash",
			"roles":    []string{"user"},
		}
		dryBytes, _ := json.Marshal(dryPayload)

		req, _ = http.NewRequest(http.MethodPost, cluster.server.URL+"/api/v1/policies/dry-run", bytes.NewReader(dryBytes))
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		req.Header.Set("Content-Type", "application/json")
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("POST /api/v1/policies/dry-run failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for dry-run, got %d", resp.StatusCode)
		}
		var dryResp map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&dryResp)
		if dryResp["effect"] != "DENY" {
			t.Errorf("expected dry-run effect DENY, got %v", dryResp["effect"])
		}

		// Delete policy rule
		req, _ = http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/api/v1/policies/%s", cluster.server.URL, createdRule.ID), nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err = client.Do(req)
		if err != nil {
			t.Fatalf("DELETE /api/v1/policies/{id} failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200 OK for delete policy, got %d", resp.StatusCode)
		}
	})

	// =========================================================================
	// 9. Security Audit Log Retrieval & Tenant Isolation
	// =========================================================================
	t.Run("Audit Log Isolation", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/audit", nil)
		req.Header.Set("Authorization", "Bearer "+tokenAdminA)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /api/v1/audit failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for audit log, got %d", resp.StatusCode)
		}
		var auditLogs []*audit.Event
		_ = json.NewDecoder(resp.Body).Decode(&auditLogs)
		// Should have audit records from tenant-a operations
		for _, entry := range auditLogs {
			if entry.TenantID != "tenant-a" {
				t.Errorf("tenant leak: expected tenant-a, got %s", entry.TenantID)
			}
		}

		// Tenant B audit log query returns only tenant-b audit entries
		reqB, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/api/v1/audit", nil)
		reqB.Header.Set("Authorization", "Bearer "+tokenAdminB)
		respB, err := client.Do(reqB)
		if err != nil {
			t.Fatalf("GET /api/v1/audit tenant-b failed: %v", err)
		}
		defer respB.Body.Close()
		var auditLogsB []*audit.Event
		_ = json.NewDecoder(respB.Body).Decode(&auditLogsB)
		for _, entry := range auditLogsB {
			if entry.TenantID != "tenant-b" {
				t.Errorf("tenant leak in tenant-b: expected tenant-b, got %s", entry.TenantID)
			}
		}
	})
}
