package transport_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"AIGateway/internal/a2a/protocol"
	"AIGateway/internal/a2a/registry"
	"AIGateway/internal/a2a/routing"
	"AIGateway/internal/a2a/tasks"
	"AIGateway/internal/a2a/transport"
	"AIGateway/internal/audit"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/policy"
	"AIGateway/internal/storage"
	"AIGateway/migrations"
)

type testEnv struct {
	reg      registry.Registry
	store    tasks.Store
	router   *routing.Router
	pe       *policy.Engine
	recorder *mockAuditRecorder
	handler  *transport.Handler
	mux      *http.ServeMux
}

type mockAuditRecorder struct {
	events []audit.Event
}

func (m *mockAuditRecorder) Record(ctx context.Context, ev audit.Event) error {
	m.events = append(m.events, ev)
	return nil
}

func (m *mockAuditRecorder) Query(ctx context.Context, f audit.Filter) ([]audit.Event, error) {
	return m.events, nil
}

func setupTestTransport(t *testing.T) *testEnv {
	t.Helper()
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	_, err = db.ExecContext(ctx, "INSERT INTO tenants (id, name, slug) VALUES ('tenant-a', 'Tenant A', 'tenant-a'), ('tenant-b', 'Tenant B', 'tenant-b')")
	if err != nil {
		t.Fatalf("failed inserting test tenants: %v", err)
	}

	reg := registry.NewSQLRegistry(db)
	store := tasks.NewSQLStore(db)

	mockClient := routing.NewMockAgentClient(&protocol.AgentCard{
		Name:            "EchoAgent",
		Version:         "1.0.0",
		ProtocolVersion: protocol.ProtocolVersion,
		Capabilities:    []string{"echo"},
	})
	mockClient.SubmitFunc = func(task *protocol.Task) (*protocol.TaskResponse, error) {
		return &protocol.TaskResponse{
			ID:            task.ID,
			Status:        protocol.StatusCompleted,
			OutputPayload: json.RawMessage(`{"reply":"processed"}`),
		}, nil
	}

	router := routing.NewRouter(routing.RouterConfig{
		Registry: reg,
		Store:    store,
		ClientFactory: func(agent *registry.Agent) (routing.AgentClient, error) {
			return mockClient, nil
		},
	})

	pe := policy.NewEngine()
	recorder := &mockAuditRecorder{}

	handler := transport.NewHandler(reg, store, router, pe, recorder, "tenant-a")
	mux := http.NewServeMux()
	handler.Mount(mux)

	return &testEnv{
		reg:      reg,
		store:    store,
		router:   router,
		pe:       pe,
		recorder: recorder,
		handler:  handler,
		mux:      mux,
	}
}

func TestHandler_AgentsDiscoveryAndCard(t *testing.T) {
	env := setupTestTransport(t)
	ctx := context.Background()

	// Register an agent
	agent := &registry.Agent{
		ID:          "agent-echo",
		TenantID:    "tenant-a",
		Name:        "echo-agent",
		EndpointURL: "http://echo:8080",
		AgentCard: protocol.AgentCard{
			Name:            "EchoAgent",
			Description:     "Echo agent card",
			Version:         "1.0.0",
			ProtocolVersion: protocol.ProtocolVersion,
			Capabilities:    []string{"echo"},
		},
	}
	if err := env.reg.RegisterAgent(ctx, agent); err != nil {
		t.Fatalf("failed registering agent: %v", err)
	}

	// Allow discovery policy
	_ = env.pe.AddRule(&policy.Rule{
		TenantID:  "tenant-a",
		Name:      "allow-discover",
		Effect:    policy.EffectAllow,
		Actions:   []string{policy.ActionA2AAgentsDiscover},
		Resources: []string{"*"},
	})

	// 1. GET /a2a/v1/agents
	req := httptest.NewRequest(http.MethodGet, "/a2a/v1/agents", nil)
	p := principal.Principal{
		Subject:  "user-1",
		TenantID: "tenant-a",
		Scopes:   []string{"a2a:agents:discover"},
	}
	req = req.WithContext(principal.WithContext(req.Context(), p))
	rec := httptest.NewRecorder()

	env.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var agents []*registry.Agent
	if err := json.Unmarshal(rec.Body.Bytes(), &agents); err != nil {
		t.Fatalf("failed unmarshaling agents: %v", err)
	}
	if len(agents) != 1 || agents[0].Name != "echo-agent" {
		t.Errorf("unexpected agents result: %+v", agents)
	}

	// 2. GET /a2a/v1/agents/echo-agent/card
	cardReq := httptest.NewRequest(http.MethodGet, "/a2a/v1/agents/echo-agent/card", nil)
	cardReq = cardReq.WithContext(principal.WithContext(cardReq.Context(), p))
	cardRec := httptest.NewRecorder()

	env.mux.ServeHTTP(cardRec, cardReq)

	if cardRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for card, got %d: %s", cardRec.Code, cardRec.Body.String())
	}
	var card protocol.AgentCard
	if err := json.Unmarshal(cardRec.Body.Bytes(), &card); err != nil {
		t.Fatalf("failed unmarshaling agent card: %v", err)
	}
	if card.Name != "EchoAgent" {
		t.Errorf("expected EchoAgent, got %s", card.Name)
	}
}

func TestHandler_TaskSubmissionSyncAndAsync(t *testing.T) {
	env := setupTestTransport(t)
	ctx := context.Background()

	agent := &registry.Agent{
		ID:          "agent-echo",
		TenantID:    "tenant-a",
		Name:        "echo-agent",
		EndpointURL: "http://echo:8080",
		AgentCard: protocol.AgentCard{
			Name:         "EchoAgent",
			Version:      "1.0.0",
			Capabilities: []string{"echo"},
		},
	}
	_ = env.reg.RegisterAgent(ctx, agent)

	// Add policy for task submission
	_ = env.pe.AddRule(&policy.Rule{
		TenantID:  "tenant-a",
		Name:      "allow-submit",
		Effect:    policy.EffectAllow,
		Actions:   []string{policy.ActionA2ATasksSubmit},
		Resources: []string{"*"},
	})

	p := principal.Principal{
		Subject:  "caller-app",
		TenantID: "tenant-a",
		Scopes:   []string{"a2a:tasks:submit"},
	}

	// 1. Synchronous Submission
	bodyBytes, _ := json.Marshal(protocol.TaskRequest{
		TargetAgentID:  "agent-echo",
		IdempotencyKey: "idemp-sync-1",
		InputPayload:   json.RawMessage(`{"msg":"sync work"}`),
	})
	req := httptest.NewRequest(http.MethodPost, "/a2a/v1/tasks", bytes.NewReader(bodyBytes))
	req = req.WithContext(principal.WithContext(req.Context(), p))
	rec := httptest.NewRecorder()

	env.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for sync task, got %d: %s", rec.Code, rec.Body.String())
	}
	var task protocol.Task
	_ = json.Unmarshal(rec.Body.Bytes(), &task)
	if task.Status != protocol.StatusCompleted {
		t.Errorf("expected COMPLETED, got %s", task.Status)
	}
	if string(task.OutputPayload) != `{"reply":"processed"}` {
		t.Errorf("unexpected output: %s", string(task.OutputPayload))
	}

	// 2. Idempotent Replay of same task
	dupReq := httptest.NewRequest(http.MethodPost, "/a2a/v1/tasks", bytes.NewReader(bodyBytes))
	dupReq = dupReq.WithContext(principal.WithContext(dupReq.Context(), p))
	dupRec := httptest.NewRecorder()

	env.mux.ServeHTTP(dupRec, dupReq)
	if dupRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for idempotent replay, got %d", dupRec.Code)
	}
	var dupTask protocol.Task
	_ = json.Unmarshal(dupRec.Body.Bytes(), &dupTask)
	if dupTask.ID != task.ID {
		t.Errorf("expected same task ID %s, got %s", task.ID, dupTask.ID)
	}

	// 3. Asynchronous Submission
	asyncBody, _ := json.Marshal(protocol.TaskRequest{
		TargetAgentID:  "agent-echo",
		IdempotencyKey: "idemp-async-1",
		InputPayload:   json.RawMessage(`{"msg":"async work"}`),
	})
	asyncReq := httptest.NewRequest(http.MethodPost, "/a2a/v1/tasks?async=true", bytes.NewReader(asyncBody))
	asyncReq = asyncReq.WithContext(principal.WithContext(asyncReq.Context(), p))
	asyncRec := httptest.NewRecorder()

	env.mux.ServeHTTP(asyncRec, asyncReq)
	if asyncRec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted, got %d: %s", asyncRec.Code, asyncRec.Body.String())
	}

	// Verify Audit Logging
	if len(env.recorder.events) < 2 {
		t.Errorf("expected at least 2 audit events recorded, got %d", len(env.recorder.events))
	}
}

func TestHandler_TaskCancelAndDetail(t *testing.T) {
	env := setupTestTransport(t)
	ctx := context.Background()

	agent := &registry.Agent{
		ID:          "agent-echo",
		TenantID:    "tenant-a",
		Name:        "echo-agent",
		EndpointURL: "http://echo:8080",
		AgentCard: protocol.AgentCard{
			Name:         "EchoAgent",
			Version:      "1.0.0",
			Capabilities: []string{"echo"},
		},
	}
	_ = env.reg.RegisterAgent(ctx, agent)

	task, _ := env.store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "caller-1",
		TargetAgentID:  "agent-echo",
		InputPayload:   json.RawMessage(`{"wait":true}`),
	})

	p := principal.Principal{
		Subject:  "caller-1",
		TenantID: "tenant-a",
		Scopes:   []string{"a2a:read", "a2a:write"},
	}

	// 1. GET /a2a/v1/tasks/{id}
	getReq := httptest.NewRequest(http.MethodGet, "/a2a/v1/tasks/"+task.ID, nil)
	getReq = getReq.WithContext(principal.WithContext(getReq.Context(), p))
	getRec := httptest.NewRecorder()

	env.mux.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", getRec.Code)
	}

	// 2. POST /a2a/v1/tasks/{id}/cancel
	cancelReq := httptest.NewRequest(http.MethodPost, "/a2a/v1/tasks/"+task.ID+"/cancel", nil)
	cancelReq = cancelReq.WithContext(principal.WithContext(cancelReq.Context(), p))
	cancelRec := httptest.NewRecorder()

	env.mux.ServeHTTP(cancelRec, cancelReq)
	if cancelRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on cancel, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	var cancelledTask protocol.Task
	_ = json.Unmarshal(cancelRec.Body.Bytes(), &cancelledTask)
	if cancelledTask.Status != protocol.StatusCancelled {
		t.Errorf("expected CANCELLED, got %s", cancelledTask.Status)
	}
}

func TestHandler_TaskEventsSSE(t *testing.T) {
	env := setupTestTransport(t)
	ctx := context.Background()

	agent := &registry.Agent{
		ID:          "agent-echo",
		TenantID:    "tenant-a",
		Name:        "echo-agent",
		EndpointURL: "http://echo:8080",
		AgentCard: protocol.AgentCard{
			Name:         "EchoAgent",
			Version:      "1.0.0",
			Capabilities: []string{"echo"},
		},
	}
	_ = env.reg.RegisterAgent(ctx, agent)

	task, _ := env.store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "caller-1",
		TargetAgentID:  "agent-echo",
		InputPayload:   json.RawMessage(`{"action":"stream"}`),
	})

	// Already has seq 1 event (PENDING)
	_ = env.store.UpdateTaskStatus(ctx, "tenant-a", task.ID, protocol.StatusRunning, nil, "", "")
	// Transition to COMPLETED
	_ = env.store.UpdateTaskStatus(ctx, "tenant-a", task.ID, protocol.StatusCompleted, []byte(`{"ok":true}`), "", "")

	p := principal.Principal{
		Subject:  "caller-1",
		TenantID: "tenant-a",
		Scopes:   []string{"a2a:read"},
	}

	sseReq := httptest.NewRequest(http.MethodGet, "/a2a/v1/tasks/"+task.ID+"/events", nil)
	sseReq = sseReq.WithContext(principal.WithContext(sseReq.Context(), p))
	sseRec := httptest.NewRecorder()

	env.mux.ServeHTTP(sseRec, sseReq)

	if sseRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for SSE, got %d: %s", sseRec.Code, sseRec.Body.String())
	}
	if !strings.Contains(sseRec.Header().Get("Content-Type"), "text/event-stream") {
		t.Errorf("expected text/event-stream content type, got %s", sseRec.Header().Get("Content-Type"))
	}

	bodyStr := sseRec.Body.String()
	// Scan SSE events
	scanner := bufio.NewScanner(strings.NewReader(bodyStr))
	eventCount := 0
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			eventCount++
		}
	}
	// We expect at least status events (PENDING, RUNNING, COMPLETED)
	if eventCount < 3 {
		t.Errorf("expected at least 3 SSE events, got %d\nBody: %s", eventCount, bodyStr)
	}
}
