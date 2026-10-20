package tasks_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"project_alpha/internal/a2a/protocol"
	"project_alpha/internal/a2a/tasks"
	"project_alpha/internal/config"
	"project_alpha/internal/storage"
	"project_alpha/migrations"
)

func setupTestStore(t *testing.T) *tasks.SQLStore {
	t.Helper()
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	// Insert parent tenants and agents
	_, err = db.ExecContext(ctx, "INSERT INTO tenants (id, name, slug) VALUES ('tenant-a', 'Tenant A', 'tenant-a'), ('tenant-b', 'Tenant B', 'tenant-b')")
	if err != nil {
		t.Fatalf("failed inserting test tenants: %v", err)
	}

	cardJSON := `{"name":"AgentA","version":"1.0","protocol_version":"a2a/v1","capabilities":["chat"]}`
	_, err = db.ExecContext(ctx, "INSERT INTO agents (id, tenant_id, name, endpoint_url, agent_card) VALUES ('agent-1', 'tenant-a', 'agent-1', 'http://agent1', $1)", cardJSON)
	if err != nil {
		t.Fatalf("failed inserting test agent: %v", err)
	}

	return tasks.NewSQLStore(db)
}

func TestSQLStore_CreateAndIdempotency(t *testing.T) {
	store := setupTestStore(t)
	ctx := context.Background()

	req := &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-x",
		TargetAgentID:  "agent-1",
		IdempotencyKey: "idemp-key-100",
		InputPayload:   json.RawMessage(`{"prompt":"summarize report","format":"bullet"}`),
	}

	// 1. Initial creation
	task1, err := store.CreateTask(ctx, req)
	if err != nil {
		t.Fatalf("initial task creation failed: %v", err)
	}
	if task1.ID == "" || task1.Status != protocol.StatusPending {
		t.Errorf("unexpected task fields: %+v", task1)
	}

	// Verify initial event was created
	events, err := store.GetEvents(ctx, "tenant-a", task1.ID, 0)
	if err != nil {
		t.Fatalf("failed getting events: %v", err)
	}
	if len(events) != 1 || events[0].SequenceNum != 1 || events[0].EventType != protocol.EventTypeStatus {
		t.Errorf("expected 1 initial status event, got %+v", events)
	}

	// 2. Exact duplicate submission (same key, same input) -> should return original task
	dupReq := &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-x",
		TargetAgentID:  "agent-1",
		IdempotencyKey: "idemp-key-100",
		InputPayload:   json.RawMessage(`{"format":"bullet","prompt":"summarize report"}`), // slightly different formatting, same JSON
	}
	task2, err := store.CreateTask(ctx, dupReq)
	if err != nil {
		t.Fatalf("duplicate submission failed: %v", err)
	}
	if task2.ID != task1.ID {
		t.Errorf("expected same task ID %s, got %s", task1.ID, task2.ID)
	}

	// 3. Conflicting submission (same key, different input) -> should fail
	conflictReq := &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-x",
		TargetAgentID:  "agent-1",
		IdempotencyKey: "idemp-key-100",
		InputPayload:   json.RawMessage(`{"prompt":"different prompt"}`),
	}
	_, err = store.CreateTask(ctx, conflictReq)
	if !errors.Is(err, protocol.ErrIdempotencyConflict) {
		t.Fatalf("expected ErrIdempotencyConflict, got %v", err)
	}
}

func TestSQLStore_LifecycleTransitions(t *testing.T) {
	store := setupTestStore(t)
	ctx := context.Background()

	task, err := store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-x",
		TargetAgentID:  "agent-1",
		InputPayload:   json.RawMessage(`{"action":"run"}`),
	})
	if err != nil {
		t.Fatalf("create task failed: %v", err)
	}

	// Subscribe to live events
	eventChan, unsub, err := store.SubscribeEvents(ctx, "tenant-a", task.ID)
	if err != nil {
		t.Fatalf("subscribe events failed: %v", err)
	}
	defer unsub()

	// 1. Transition PENDING -> RUNNING
	if err := store.UpdateTaskStatus(ctx, "tenant-a", task.ID, protocol.StatusRunning, nil, "", ""); err != nil {
		t.Fatalf("update to RUNNING failed: %v", err)
	}

	select {
	case ev := <-eventChan:
		if ev.EventType != protocol.EventTypeStatus {
			t.Errorf("expected status event, got %s", ev.EventType)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for RUNNING event")
	}

	// Check stored status
	cur, _ := store.GetTask(ctx, "tenant-a", task.ID)
	if cur.Status != protocol.StatusRunning {
		t.Errorf("expected RUNNING, got %s", cur.Status)
	}

	// 2. Append an intermediate message event
	msgPayload := json.RawMessage(`{"text":"processing step 1 of 3"}`)
	if err := store.AppendEvent(ctx, &protocol.TaskEvent{
		TaskID:    task.ID,
		TenantID:  "tenant-a",
		EventType: protocol.EventTypeMessage,
		Payload:   msgPayload,
	}); err != nil {
		t.Fatalf("append message event failed: %v", err)
	}

	select {
	case ev := <-eventChan:
		if ev.EventType != protocol.EventTypeMessage {
			t.Errorf("expected message event, got %s", ev.EventType)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for message event")
	}

	// 3. Transition RUNNING -> COMPLETED
	output := []byte(`{"result":"all steps completed successfully"}`)
	if err := store.UpdateTaskStatus(ctx, "tenant-a", task.ID, protocol.StatusCompleted, output, "", ""); err != nil {
		t.Fatalf("update to COMPLETED failed: %v", err)
	}

	cur, _ = store.GetTask(ctx, "tenant-a", task.ID)
	if cur.Status != protocol.StatusCompleted {
		t.Errorf("expected COMPLETED, got %s", cur.Status)
	}
	if string(cur.OutputPayload) != string(output) {
		t.Errorf("expected output %s, got %s", string(output), string(cur.OutputPayload))
	}

	// 4. Updating terminal task should fail with ErrTaskAlreadyDone
	err = store.UpdateTaskStatus(ctx, "tenant-a", task.ID, protocol.StatusFailed, nil, "ERR", "fail")
	if !errors.Is(err, protocol.ErrTaskAlreadyDone) {
		t.Errorf("expected ErrTaskAlreadyDone, got %v", err)
	}

	// 5. Verify all events in historical sequence
	allEvents, err := store.GetEvents(ctx, "tenant-a", task.ID, 0)
	if err != nil {
		t.Fatalf("failed getting all events: %v", err)
	}
	// seq 1: PENDING, seq 2: RUNNING, seq 3: message, seq 4: COMPLETED
	if len(allEvents) != 4 {
		t.Fatalf("expected 4 total events, got %d", len(allEvents))
	}
	for i, ev := range allEvents {
		expectedSeq := i + 1
		if ev.SequenceNum != expectedSeq {
			t.Errorf("event %d has sequence %d, expected %d", i, ev.SequenceNum, expectedSeq)
		}
	}
}

func TestSQLStore_TenantIsolation(t *testing.T) {
	store := setupTestStore(t)
	ctx := context.Background()

	task, err := store.CreateTask(ctx, &protocol.Task{
		TenantID:       "tenant-a",
		CallerClientID: "client-x",
		TargetAgentID:  "agent-1",
		InputPayload:   json.RawMessage(`{"secure":"data"}`),
	})
	if err != nil {
		t.Fatalf("create task failed: %v", err)
	}

	// Tenant B cannot get task
	_, err = store.GetTask(ctx, "tenant-b", task.ID)
	if !errors.Is(err, tasks.ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound for tenant-b, got %v", err)
	}

	// Tenant B list is empty
	bList, err := store.ListTasks(ctx, "tenant-b", "", 10)
	if err != nil || len(bList) != 0 {
		t.Errorf("expected 0 tasks for tenant-b, got %v (%d)", err, len(bList))
	}

	// Tenant B cannot update status
	err = store.UpdateTaskStatus(ctx, "tenant-b", task.ID, protocol.StatusRunning, nil, "", "")
	if !errors.Is(err, tasks.ErrTaskNotFound) {
		t.Errorf("expected ErrTaskNotFound updating from tenant-b, got %v", err)
	}

	// Tenant B cannot read events
	bEvents, err := store.GetEvents(ctx, "tenant-b", task.ID, 0)
	if err != nil || len(bEvents) != 0 {
		t.Errorf("expected 0 events for tenant-b, got %v (%d)", err, len(bEvents))
	}
}
