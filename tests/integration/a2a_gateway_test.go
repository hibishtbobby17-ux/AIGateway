package integration_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"project_alpha/internal/a2a/protocol"
	a2aregistry "project_alpha/internal/a2a/registry"
	"project_alpha/internal/a2a/routing"
	"project_alpha/internal/a2a/tasks"
	a2atransport "project_alpha/internal/a2a/transport"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/config"
	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/tokens"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
	"project_alpha/internal/tenants"
	"project_alpha/migrations"
)

type a2aTestCluster struct {
	server       *httptest.Server
	keyManager   *keys.Manager
	policyEngine *policy.Engine
	auditRec     audit.Recorder
	a2aReg       a2aregistry.Registry
	a2aStore     tasks.Store
	a2aRouter    *routing.Router
	upstreamURL  string
	lastReqTrace string
	lastReqAuth  string
}

func setupA2AGatewayCluster(t *testing.T) *a2aTestCluster {
	t.Helper()
	ctx := context.Background()

	// 1. In-memory database with migrations
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

	// 2. Tenants
	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-a", Name: "Tenant A", Slug: "tenant-a"})
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-b", Name: "Tenant B", Slug: "tenant-b"})

	// 3. Keys and token verifier
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}
	revocationStore := tokens.NewRevocationManager()
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://gateway.example.com", "ai-gateway")

	// 4. Policy Engine
	policyEngine := policy.NewEngine()
	_ = policyEngine.AddRule(&policy.Rule{
		TenantID:  "tenant-a",
		Name:      "allow-a2a-discover",
		Effect:    policy.EffectAllow,
		Actions:   []string{policy.ActionA2AAgentsDiscover},
		Resources: []string{"*"},
		Roles:     []string{policy.RoleAgentOperator},
	})
	_ = policyEngine.AddRule(&policy.Rule{
		TenantID:  "tenant-a",
		Name:      "allow-a2a-submit",
		Effect:    policy.EffectAllow,
		Actions:   []string{policy.ActionA2ATasksSubmit},
		Resources: []string{"*"},
		Roles:     []string{policy.RoleAgentOperator},
	})

	cluster := &a2aTestCluster{
		keyManager:   keyManager,
		policyEngine: policyEngine,
	}

	// 5. Mock Upstream Agent HTTP Server
	upstreamMux := http.NewServeMux()
	agentCard := protocol.AgentCard{
		Name:            "EchoAgent",
		Description:     "Echo agent for testing",
		Version:         "1.0.0",
		ProtocolVersion: protocol.ProtocolVersion,
		Capabilities:    []string{"echo", "summarize"},
	}

	upstreamMux.HandleFunc("/card", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(agentCard)
	})
	upstreamMux.HandleFunc("/tasks", func(w http.ResponseWriter, r *http.Request) {
		cluster.lastReqTrace = r.Header.Get("traceparent")
		cluster.lastReqAuth = r.Header.Get("Authorization")

		body, _ := io.ReadAll(r.Body)
		var taskPayload map[string]any
		_ = json.Unmarshal(body, &taskPayload)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(protocol.TaskResponse{
			ID:            fmt.Sprintf("%v", taskPayload["id"]),
			Status:        protocol.StatusCompleted,
			OutputPayload: json.RawMessage(`{"result":"processed successfully"}`),
		})
	})
	upstreamMux.HandleFunc("/tasks/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/cancel") {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	})

	upstreamServer := httptest.NewServer(upstreamMux)
	t.Cleanup(func() { upstreamServer.Close() })
	cluster.upstreamURL = upstreamServer.URL

	// 6. A2A Components
	auditRec := audit.NewSQLRecorder(db)
	a2aReg := a2aregistry.NewSQLRegistry(db)
	a2aStore := tasks.NewSQLStore(db)

	tokenExchanger, _ := delegation.NewTokenExchanger(keyManager, "https://gateway.example.com", 5*time.Minute)
	credentialProvider := delegation.NewProvider(tokenExchanger)

	a2aRouter := routing.NewRouter(routing.RouterConfig{
		Registry:           a2aReg,
		Store:              a2aStore,
		CredentialProvider: credentialProvider,
		AllowLocalEgress:   true,
	})
	t.Cleanup(func() { _ = a2aRouter.Close() })

	cluster.auditRec = auditRec
	cluster.a2aReg = a2aReg
	cluster.a2aStore = a2aStore
	cluster.a2aRouter = a2aRouter

	// Register agent in tenant-a
	_ = a2aReg.RegisterAgent(ctx, &a2aregistry.Agent{
		ID:          "agent-echo",
		TenantID:    "tenant-a",
		Name:        "echo-agent",
		EndpointURL: cluster.upstreamURL,
		AgentCard:   agentCard,
		AuthType:    "NONE",
	})

	a2aHandler := a2atransport.NewHandler(a2aReg, a2aStore, a2aRouter, policyEngine, auditRec, "tenant-a")

	// 7. Gateway HTTP ServeMux
	mux := http.NewServeMux()
	a2aHandler.Mount(mux)

	// Protected by AuthMiddleware
	gwServer := httptest.NewServer(middleware.AuthMiddleware(verifier, policyEngine)(mux))
	t.Cleanup(func() { gwServer.Close() })
	cluster.server = gwServer

	return cluster
}

func (c *a2aTestCluster) mintToken(t *testing.T, tenantID, subject string, roles, scopes []string) string {
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
		Scopes:    scopes,
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(time.Hour).Unix(),
		TokenID:   "token-test-a2a",
	}
	tokenStr, err := tokens.Sign(claims, activeKey)
	if err != nil {
		t.Fatalf("sign token failed: %v", err)
	}
	return tokenStr
}

func TestA2AGateway_EndToEnd(t *testing.T) {
	cluster := setupA2AGatewayCluster(t)

	tokenA := cluster.mintToken(t, "tenant-a", "user-alice", []string{policy.RoleAgentOperator}, []string{"a2a:agents:discover", "a2a:tasks:submit", "a2a:read", "a2a:write"})
	tokenB := cluster.mintToken(t, "tenant-b", "user-bob", []string{policy.RoleAgentOperator}, []string{"a2a:agents:discover", "a2a:tasks:submit", "a2a:read", "a2a:write"})

	client := &http.Client{Timeout: 10 * time.Second}

	// -------------------------------------------------------------------------
	// 1. Agent Discovery: Tenant A discovers registered agent
	// -------------------------------------------------------------------------
	t.Run("Agent Discovery Tenant A", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/a2a/v1/agents", nil)
		req.Header.Set("Authorization", "Bearer "+tokenA)

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /a2a/v1/agents failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, string(body))
		}

		var agents []*a2aregistry.Agent
		_ = json.NewDecoder(resp.Body).Decode(&agents)
		if len(agents) != 1 || agents[0].Name != "echo-agent" {
			t.Fatalf("expected 1 agent 'echo-agent', got %+v", agents)
		}
	})

	// -------------------------------------------------------------------------
	// 2. Tenant Isolation: Tenant B cannot discover Tenant A's agent
	// -------------------------------------------------------------------------
	t.Run("Agent Discovery Tenant Isolation", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/a2a/v1/agents", nil)
		req.Header.Set("Authorization", "Bearer "+tokenB)

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /a2a/v1/agents failed: %v", err)
		}
		defer resp.Body.Close()

		var agents []*a2aregistry.Agent
		_ = json.NewDecoder(resp.Body).Decode(&agents)
		if len(agents) != 0 {
			t.Fatalf("tenant-b should see 0 agents, got %d", len(agents))
		}
	})

	// -------------------------------------------------------------------------
	// 3. Agent Card Retrieval
	// -------------------------------------------------------------------------
	t.Run("Agent Card Retrieval", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/a2a/v1/agents/agent-echo/card", nil)
		req.Header.Set("Authorization", "Bearer "+tokenA)

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET card failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var card protocol.AgentCard
		_ = json.NewDecoder(resp.Body).Decode(&card)
		if card.Name != "EchoAgent" || len(card.Capabilities) != 2 {
			t.Errorf("unexpected card content: %+v", card)
		}
	})

	// -------------------------------------------------------------------------
	// 4. Synchronous Task Submission with Traceparent & Idempotency
	// -------------------------------------------------------------------------
	var completedTaskID string
	t.Run("Sync Task Submission and Idempotency", func(t *testing.T) {
		payload := protocol.TaskRequest{
			TargetAgentID:  "agent-echo",
			IdempotencyKey: "idemp-test-42",
			InputPayload:   json.RawMessage(`{"prompt":"hello world"}`),
		}
		bodyBytes, _ := json.Marshal(payload)

		req, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/a2a/v1/tasks", bytes.NewReader(bodyBytes))
		req.Header.Set("Authorization", "Bearer "+tokenA)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Trace-ID", "trace-test-424242")

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("POST /a2a/v1/tasks failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			b, _ := io.ReadAll(resp.Body)
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(b))
		}

		var task protocol.Task
		_ = json.NewDecoder(resp.Body).Decode(&task)
		if task.Status != protocol.StatusCompleted {
			t.Errorf("expected task COMPLETED, got %s", task.Status)
		}
		if string(task.OutputPayload) != `{"result":"processed successfully"}` {
			t.Errorf("unexpected output payload: %s", string(task.OutputPayload))
		}
		completedTaskID = task.ID

		// Verify W3C traceparent was forwarded to upstream agent
		if !strings.HasPrefix(cluster.lastReqTrace, "00-") {
			t.Errorf("expected W3C traceparent on upstream request, got %q", cluster.lastReqTrace)
		}

		// Re-submit identical task with same idempotency key -> returns existing task without error
		dupReq, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/a2a/v1/tasks", bytes.NewReader(bodyBytes))
		dupReq.Header.Set("Authorization", "Bearer "+tokenA)
		dupReq.Header.Set("Content-Type", "application/json")

		dupResp, err := client.Do(dupReq)
		if err != nil {
			t.Fatalf("duplicate POST /a2a/v1/tasks failed: %v", err)
		}
		defer dupResp.Body.Close()

		if dupResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK on duplicate, got %d", dupResp.StatusCode)
		}
		var dupTask protocol.Task
		_ = json.NewDecoder(dupResp.Body).Decode(&dupTask)
		if dupTask.ID != completedTaskID {
			t.Errorf("expected same task ID %s, got %s", completedTaskID, dupTask.ID)
		}

		// Conflicting re-submission (same key, different input payload) -> 409 Conflict
		conflictPayload := protocol.TaskRequest{
			TargetAgentID:  "agent-echo",
			IdempotencyKey: "idemp-test-42",
			InputPayload:   json.RawMessage(`{"prompt":"conflicting input"}`),
		}
		confBytes, _ := json.Marshal(conflictPayload)
		confReq, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/a2a/v1/tasks", bytes.NewReader(confBytes))
		confReq.Header.Set("Authorization", "Bearer "+tokenA)
		confReq.Header.Set("Content-Type", "application/json")

		confResp, err := client.Do(confReq)
		if err != nil {
			t.Fatalf("conflicting POST failed: %v", err)
		}
		defer confResp.Body.Close()
		if confResp.StatusCode != http.StatusConflict {
			t.Errorf("expected 409 Conflict, got %d", confResp.StatusCode)
		}
	})

	// -------------------------------------------------------------------------
	// 5. Task Detail & Cancellation
	// -------------------------------------------------------------------------
	t.Run("Task Detail and Cancellation", func(t *testing.T) {
		// Create a task to cancel
		task, err := cluster.a2aStore.CreateTask(context.Background(), &protocol.Task{
			TenantID:       "tenant-a",
			CallerClientID: "user-alice",
			TargetAgentID:  "agent-echo",
			InputPayload:   json.RawMessage(`{"job":"cancel_me"}`),
		})
		if err != nil {
			t.Fatalf("failed creating task: %v", err)
		}

		// GET task detail
		getReq, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/a2a/v1/tasks/"+task.ID, nil)
		getReq.Header.Set("Authorization", "Bearer "+tokenA)
		getResp, err := client.Do(getReq)
		if err != nil || getResp.StatusCode != http.StatusOK {
			t.Fatalf("failed getting task detail: %v", err)
		}
		_ = getResp.Body.Close()

		// POST cancel
		cancelReq, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/a2a/v1/tasks/"+task.ID+"/cancel", nil)
		cancelReq.Header.Set("Authorization", "Bearer "+tokenA)
		cancelResp, err := client.Do(cancelReq)
		if err != nil || cancelResp.StatusCode != http.StatusOK {
			t.Fatalf("failed cancelling task: %v", err)
		}
		defer cancelResp.Body.Close()

		var cancelledTask protocol.Task
		_ = json.NewDecoder(cancelResp.Body).Decode(&cancelledTask)
		if cancelledTask.Status != protocol.StatusCancelled {
			t.Errorf("expected CANCELLED, got %s", cancelledTask.Status)
		}
	})

	// -------------------------------------------------------------------------
	// 6. Async Task Submission & SSE Stream
	// -------------------------------------------------------------------------
	t.Run("Async Task and SSE Streaming", func(t *testing.T) {
		asyncPayload := protocol.TaskRequest{
			TargetAgentID: "agent-echo",
			InputPayload:  json.RawMessage(`{"mode":"stream_test"}`),
		}
		asyncBytes, _ := json.Marshal(asyncPayload)
		req, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/a2a/v1/tasks?async=true", bytes.NewReader(asyncBytes))
		req.Header.Set("Authorization", "Bearer "+tokenA)
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("async task submission failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusAccepted {
			t.Fatalf("expected 202 Accepted, got %d", resp.StatusCode)
		}

		var asyncTask protocol.Task
		_ = json.NewDecoder(resp.Body).Decode(&asyncTask)

		// Connect to SSE event stream
		sseReq, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/a2a/v1/tasks/"+asyncTask.ID+"/events", nil)
		sseReq.Header.Set("Authorization", "Bearer "+tokenA)
		sseResp, err := client.Do(sseReq)
		if err != nil {
			t.Fatalf("SSE connection failed: %v", err)
		}
		defer sseResp.Body.Close()

		if sseResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 for SSE, got %d", sseResp.StatusCode)
		}

		scanner := bufio.NewScanner(sseResp.Body)
		eventReceived := false
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event: ") {
				eventReceived = true
				break
			}
		}
		if !eventReceived {
			t.Errorf("expected at least one SSE event from stream")
		}
	})

	// -------------------------------------------------------------------------
	// 7. Policy Denial: Token without required scope is denied
	// -------------------------------------------------------------------------
	t.Run("Policy Denial Without Scopes", func(t *testing.T) {
		unauthorizedToken := cluster.mintToken(t, "tenant-a", "user-bad", []string{policy.RoleAgentOperator}, []string{"mcp:read"}) // Missing a2a:* scopes

		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/a2a/v1/agents", nil)
		req.Header.Set("Authorization", "Bearer "+unauthorizedToken)

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET /a2a/v1/agents failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden without a2a:agents:discover scope, got %d", resp.StatusCode)
		}
	})

	// -------------------------------------------------------------------------
	// 8. Audit Trail Verification
	// -------------------------------------------------------------------------
	t.Run("Audit Trail Verification", func(t *testing.T) {
		events, err := cluster.auditRec.Query(context.Background(), audit.Filter{
			TenantID: "tenant-a",
		})
		if err != nil {
			t.Fatalf("failed querying audit logs: %v", err)
		}

		hasTaskSubmit := false
		for _, ev := range events {
			if ev.Action == audit.ActionA2ATaskSubmit {
				hasTaskSubmit = true
				break
			}
		}
		if !hasTaskSubmit {
			t.Errorf("expected at least one a2a.task.submit audit record in tenant-a")
		}
	})
}
