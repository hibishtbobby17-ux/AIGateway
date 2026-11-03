package routing_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"AIGateway/internal/a2a/protocol"
	"AIGateway/internal/a2a/registry"
	"AIGateway/internal/a2a/routing"
	"AIGateway/internal/a2a/tasks"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/delegation"
	"AIGateway/internal/storage"
	"AIGateway/migrations"
)

func setupTestEnvironment(t *testing.T) (registry.Registry, tasks.Store) {
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
	return reg, store
}

func sampleCard() protocol.AgentCard {
	return protocol.AgentCard{
		Name:            "EchoAgent",
		Description:     "Echoes input data",
		Version:         "1.0.0",
		ProtocolVersion: protocol.ProtocolVersion,
		Capabilities:    []string{"echo"},
	}
}

func TestHTTPAgentClient_FetchAgentCardAndSubmit(t *testing.T) {
	card := sampleCard()
	var receivedTraceparent string
	var receivedAuth string

	// Upstream HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedTraceparent = r.Header.Get("traceparent")
		receivedAuth = r.Header.Get("Authorization")

		switch r.URL.Path {
		case "/card":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(card)
		case "/tasks":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(protocol.TaskResponse{
				ID:            "task-123",
				Status:        protocol.StatusCompleted,
				OutputPayload: json.RawMessage(`{"echo":"hello world"}`),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := routing.NewHTTPAgentClient(routing.ClientConfig{
		AgentID:          "agent-echo",
		EndpointURL:      server.URL,
		Timeout:          5 * time.Second,
		AllowLocalEgress: true, // Allow test server URL
		AuthConfig: delegation.UpstreamAuthConfig{
			StaticToken: "static-secret-token",
		},
	})
	defer client.Close()

	ctx := context.Background()

	// 1. Fetch Agent Card
	fetchedCard, err := client.FetchAgentCard(ctx)
	if err != nil {
		t.Fatalf("fetch agent card failed: %v", err)
	}
	if fetchedCard.Name != "EchoAgent" {
		t.Errorf("expected EchoAgent, got %s", fetchedCard.Name)
	}

	// 2. Submit Task
	task := &protocol.Task{
		ID:             "task-123",
		TenantID:       "tenant-a",
		CallerClientID: "client-abc",
		TargetAgentID:  "agent-echo",
		IdempotencyKey: "key-xyz",
		InputPayload:   json.RawMessage(`{"text":"hello world"}`),
		TraceID:        "0123456789abcdef0123456789abcdef",
	}

	resp, err := client.SubmitTask(ctx, task)
	if err != nil {
		t.Fatalf("submit task failed: %v", err)
	}
	if resp.Status != protocol.StatusCompleted {
		t.Errorf("expected COMPLETED, got %s", resp.Status)
	}

	// Verify traceparent injected
	if !strings.HasPrefix(receivedTraceparent, "00-") {
		t.Errorf("expected W3C traceparent header, got %q", receivedTraceparent)
	}
	// Verify static bearer applied
	if receivedAuth != "Bearer static-secret-token" {
		t.Errorf("expected static bearer auth, got %q", receivedAuth)
	}
}

func TestHTTPAgentClient_AntiRelayProtection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	inboundToken := "raw-caller-jwt-token"
	client := routing.NewHTTPAgentClient(routing.ClientConfig{
		AgentID:          "agent-echo",
		EndpointURL:      server.URL,
		Timeout:          5 * time.Second,
		AllowLocalEgress: true,
		AuthConfig: delegation.UpstreamAuthConfig{
			StaticToken: inboundToken, // ATTEMPT TO RELAY SAME TOKEN
		},
	})
	defer client.Close()

	ctx := delegation.WithInboundToken(context.Background(), inboundToken)

	task := &protocol.Task{
		ID:           "task-relay",
		TenantID:     "tenant-a",
		InputPayload: json.RawMessage(`{}`),
	}

	_, err := client.SubmitTask(ctx, task)
	if !errors.Is(err, delegation.ErrTokenRelayBlocked) {
		t.Fatalf("expected ErrTokenRelayBlocked, got %v", err)
	}
}

func TestRouter_ExecuteTaskLifecycle(t *testing.T) {
	reg, store := setupTestEnvironment(t)
	ctx := context.Background()

	// Register agent
	agent := &registry.Agent{
		ID:          "agent-calc",
		TenantID:    "tenant-a",
		Name:        "calculator",
		EndpointURL: "http://mock-calc",
		AgentCard:   sampleCard(),
	}
	if err := reg.RegisterAgent(ctx, agent); err != nil {
		t.Fatalf("failed registering agent: %v", err)
	}

	// Create mock client
	mockClient := routing.NewMockAgentClient(&agent.AgentCard)
	mockClient.SubmitFunc = func(task *protocol.Task) (*protocol.TaskResponse, error) {
		return &protocol.TaskResponse{
			ID:            task.ID,
			Status:        protocol.StatusCompleted,
			OutputPayload: json.RawMessage(`{"result": 42}`),
		}, nil
	}

	router := routing.NewRouter(routing.RouterConfig{
		Registry: reg,
		Store:    store,
		ClientFactory: func(a *registry.Agent) (routing.AgentClient, error) {
			return mockClient, nil
		},
	})
	defer router.Close()

	// 1. Submit task in store
	task, err := store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-app",
		TargetAgentID:  "agent-calc",
		InputPayload:   json.RawMessage(`{"expr":"6 * 7"}`),
	})
	if err != nil {
		t.Fatalf("create task failed: %v", err)
	}
	if task.Status != protocol.StatusPending {
		t.Errorf("expected PENDING initial status, got %s", task.Status)
	}

	// 2. Execute task through router
	resp, err := router.ExecuteTask(ctx, task)
	if err != nil {
		t.Fatalf("execute task failed: %v", err)
	}
	if resp.Status != protocol.StatusCompleted {
		t.Errorf("expected COMPLETED, got %s", resp.Status)
	}

	// 3. Verify final state in durable store
	storedTask, err := store.GetTask(ctx, "tenant-a", task.ID)
	if err != nil {
		t.Fatalf("get task failed: %v", err)
	}
	if storedTask.Status != protocol.StatusCompleted {
		t.Errorf("expected stored status COMPLETED, got %s", storedTask.Status)
	}
	if string(storedTask.OutputPayload) != `{"result": 42}` {
		t.Errorf("unexpected output payload: %s", string(storedTask.OutputPayload))
	}
}

func TestRouter_DeadlineAndCancellation(t *testing.T) {
	reg, store := setupTestEnvironment(t)
	ctx := context.Background()

	agent := &registry.Agent{
		ID:          "agent-slow",
		TenantID:    "tenant-a",
		Name:        "slow-agent",
		EndpointURL: "http://mock-slow",
		AgentCard:   sampleCard(),
	}
	if err := reg.RegisterAgent(ctx, agent); err != nil {
		t.Fatalf("failed registering agent: %v", err)
	}

	mockClient := routing.NewMockAgentClient(&agent.AgentCard)
	mockClient.SubmitFunc = func(task *protocol.Task) (*protocol.TaskResponse, error) {
		time.Sleep(100 * time.Millisecond)
		return nil, context.DeadlineExceeded
	}

	router := routing.NewRouter(routing.RouterConfig{
		Registry: reg,
		Store:    store,
		ClientFactory: func(a *registry.Agent) (routing.AgentClient, error) {
			return mockClient, nil
		},
	})
	defer router.Close()

	deadline := time.Now().Add(50 * time.Millisecond)
	task, err := store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-app",
		TargetAgentID:  "agent-slow",
		Deadline:       &deadline,
		InputPayload:   json.RawMessage(`{"work":"long"}`),
	})
	if err != nil {
		t.Fatalf("create task failed: %v", err)
	}

	// Execute with short deadline
	_, err = router.ExecuteTask(ctx, task)
	if !errors.Is(err, protocol.ErrTaskTimeout) {
		t.Errorf("expected ErrTaskTimeout, got %v", err)
	}

	// Verify task transitioned to TIMED_OUT in store
	stored, _ := store.GetTask(ctx, "tenant-a", task.ID)
	if stored.Status != protocol.StatusTimedOut {
		t.Errorf("expected TIMED_OUT status, got %s", stored.Status)
	}

	// Test CancelTask
	task2, _ := store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-app",
		TargetAgentID:  "agent-slow",
		InputPayload:   json.RawMessage(`{"cancel":"me"}`),
	})
	if err := router.CancelTask(ctx, "tenant-a", task2.ID); err != nil {
		t.Fatalf("cancel task failed: %v", err)
	}
	stored2, _ := store.GetTask(ctx, "tenant-a", task2.ID)
	if stored2.Status != protocol.StatusCancelled {
		t.Errorf("expected CANCELLED status, got %s", stored2.Status)
	}
}
