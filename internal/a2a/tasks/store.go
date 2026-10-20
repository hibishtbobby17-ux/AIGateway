package tasks

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"project_alpha/internal/a2a/protocol"
)

var (
	ErrTaskNotFound = errors.New("task not found")
	ErrInvalidTask  = errors.New("invalid task request")
)

// Store defines persistent storage and live event streaming for A2A tasks.
type Store interface {
	CreateTask(ctx context.Context, task *protocol.Task) (*protocol.Task, error)
	GetTask(ctx context.Context, tenantID, taskID string) (*protocol.Task, error)
	ListTasks(ctx context.Context, tenantID string, statusFilter string, limit int) ([]*protocol.Task, error)
	UpdateTaskStatus(ctx context.Context, tenantID, taskID, status string, output []byte, errCode, errMsg string) error
	AppendEvent(ctx context.Context, event *protocol.TaskEvent) error
	GetEvents(ctx context.Context, tenantID, taskID string, afterSeq int) ([]*protocol.TaskEvent, error)
	SubscribeEvents(ctx context.Context, tenantID, taskID string) (<-chan *protocol.TaskEvent, func(), error)
}

// SQLStore implements Store backed by PostgreSQL or SQLite.
type SQLStore struct {
	db          *sql.DB
	mu          sync.RWMutex
	subscribers map[string][]chan *protocol.TaskEvent // key: tenantID + ":" + taskID
}

// NewSQLStore creates a new SQLStore.
func NewSQLStore(db *sql.DB) *SQLStore {
	return &SQLStore{
		db:          db,
		subscribers: make(map[string][]chan *protocol.TaskEvent),
	}
}

func (s *SQLStore) CreateTask(ctx context.Context, task *protocol.Task) (*protocol.Task, error) {
	if task == nil {
		return nil, ErrInvalidTask
	}
	if strings.TrimSpace(task.TenantID) == "" || strings.TrimSpace(task.TargetAgentID) == "" || strings.TrimSpace(task.CallerClientID) == "" {
		return nil, fmt.Errorf("%w: tenant_id, caller_client_id, and target_agent_id are required", ErrInvalidTask)
	}
	if len(task.InputPayload) == 0 {
		return nil, fmt.Errorf("%w: input_payload is required", ErrInvalidTask)
	}

	// 1. Idempotency Check: if idempotency_key is provided, check for existing task
	if task.IdempotencyKey != "" {
		existing, err := s.getByIdempotencyKey(ctx, task.TenantID, task.CallerClientID, task.IdempotencyKey)
		if err == nil && existing != nil {
			// Compare input payloads
			if !jsonEqual(task.InputPayload, existing.InputPayload) {
				return nil, protocol.ErrIdempotencyConflict
			}
			return existing, nil
		}
	}

	// 2. Initialize defaults
	if task.ID == "" {
		task.ID = uuid.NewString()
	}
	if task.Status == "" {
		task.Status = protocol.StatusPending
	}
	now := time.Now().UTC()
	if task.CreatedAt.IsZero() {
		task.CreatedAt = now
	}
	task.UpdatedAt = now

	insertSQL := `
		INSERT INTO a2a_tasks (
			id, tenant_id, caller_client_id, target_agent_id,
			idempotency_key, status, deadline, input_payload,
			output_payload, error_code, error_message, trace_id,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`
	var deadlineVal *time.Time
	if task.Deadline != nil && !task.Deadline.IsZero() {
		deadlineVal = task.Deadline
	}
	var outputVal *string
	if len(task.OutputPayload) > 0 {
		str := string(task.OutputPayload)
		outputVal = &str
	}
	var idempKey *string
	if task.IdempotencyKey != "" {
		idempKey = &task.IdempotencyKey
	}

	_, err := s.db.ExecContext(ctx, insertSQL,
		task.ID,
		task.TenantID,
		task.CallerClientID,
		task.TargetAgentID,
		idempKey,
		task.Status,
		deadlineVal,
		string(task.InputPayload),
		outputVal,
		task.ErrorCode,
		task.ErrorMessage,
		task.TraceID,
		task.CreatedAt,
		task.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	// Append initial lifecycle event
	statusPayload, _ := json.Marshal(map[string]string{"status": task.Status})
	_ = s.AppendEvent(ctx, &protocol.TaskEvent{
		TaskID:      task.ID,
		TenantID:    task.TenantID,
		SequenceNum: 1,
		EventType:   protocol.EventTypeStatus,
		Payload:     statusPayload,
		Timestamp:   task.CreatedAt,
	})

	return task, nil
}

func (s *SQLStore) getByIdempotencyKey(ctx context.Context, tenantID, callerClientID, key string) (*protocol.Task, error) {
	query := `
		SELECT id, tenant_id, caller_client_id, target_agent_id,
		       idempotency_key, status, deadline, input_payload,
		       output_payload, error_code, error_message, trace_id,
		       created_at, updated_at
		FROM a2a_tasks
		WHERE tenant_id = $1 AND caller_client_id = $2 AND idempotency_key = $3
	`
	row := s.db.QueryRowContext(ctx, query, tenantID, callerClientID, key)
	return scanTask(row)
}

func (s *SQLStore) GetTask(ctx context.Context, tenantID, taskID string) (*protocol.Task, error) {
	if tenantID == "" || taskID == "" {
		return nil, ErrTaskNotFound
	}
	query := `
		SELECT id, tenant_id, caller_client_id, target_agent_id,
		       idempotency_key, status, deadline, input_payload,
		       output_payload, error_code, error_message, trace_id,
		       created_at, updated_at
		FROM a2a_tasks
		WHERE tenant_id = $1 AND id = $2
	`
	row := s.db.QueryRowContext(ctx, query, tenantID, taskID)
	return scanTask(row)
}

func (s *SQLStore) ListTasks(ctx context.Context, tenantID string, statusFilter string, limit int) ([]*protocol.Task, error) {
	if tenantID == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var rows *sql.Rows
	var err error
	if statusFilter != "" {
		query := `
			SELECT id, tenant_id, caller_client_id, target_agent_id,
			       idempotency_key, status, deadline, input_payload,
			       output_payload, error_code, error_message, trace_id,
			       created_at, updated_at
			FROM a2a_tasks
			WHERE tenant_id = $1 AND status = $2
			ORDER BY created_at DESC
			LIMIT $3
		`
		rows, err = s.db.QueryContext(ctx, query, tenantID, statusFilter, limit)
	} else {
		query := `
			SELECT id, tenant_id, caller_client_id, target_agent_id,
			       idempotency_key, status, deadline, input_payload,
			       output_payload, error_code, error_message, trace_id,
			       created_at, updated_at
			FROM a2a_tasks
			WHERE tenant_id = $1
			ORDER BY created_at DESC
			LIMIT $2
		`
		rows, err = s.db.QueryContext(ctx, query, tenantID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query tasks: %w", err)
	}
	defer rows.Close()

	var tasks []*protocol.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error reading task rows: %w", err)
	}
	return tasks, nil
}

func (s *SQLStore) UpdateTaskStatus(ctx context.Context, tenantID, taskID, newStatus string, output []byte, errCode, errMsg string) error {
	if tenantID == "" || taskID == "" {
		return ErrTaskNotFound
	}

	// 1. Fetch current status to validate transition
	current, err := s.GetTask(ctx, tenantID, taskID)
	if err != nil {
		return err
	}
	if current.IsTerminal() {
		return protocol.ErrTaskAlreadyDone
	}

	if !isValidTransition(current.Status, newStatus) {
		return fmt.Errorf("%w: invalid transition from %s to %s", protocol.ErrInvalidTaskStatus, current.Status, newStatus)
	}

	now := time.Now().UTC()
	var outputVal *string
	if len(output) > 0 {
		str := string(output)
		outputVal = &str
	}

	updateSQL := `
		UPDATE a2a_tasks
		SET status = $1, output_payload = COALESCE($2, output_payload),
		    error_code = $3, error_message = $4, updated_at = $5
		WHERE tenant_id = $6 AND id = $7
	`
	res, err := s.db.ExecContext(ctx, updateSQL, newStatus, outputVal, errCode, errMsg, now, tenantID, taskID)
	if err != nil {
		return fmt.Errorf("failed to update task status: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check rows affected: %w", err)
	}
	if n == 0 {
		return ErrTaskNotFound
	}

	// 2. Append event for status change
	eventPayload := map[string]any{
		"status": newStatus,
	}
	if errCode != "" || errMsg != "" {
		eventPayload["error_code"] = errCode
		eventPayload["error_message"] = errMsg
	}
	payloadBytes, _ := json.Marshal(eventPayload)
	_ = s.AppendEvent(ctx, &protocol.TaskEvent{
		TaskID:    taskID,
		TenantID:  tenantID,
		EventType: protocol.EventTypeStatus,
		Payload:   payloadBytes,
		Timestamp: now,
	})

	return nil
}

func (s *SQLStore) AppendEvent(ctx context.Context, event *protocol.TaskEvent) error {
	if event == nil || event.TaskID == "" || event.TenantID == "" {
		return fmt.Errorf("task_id and tenant_id are required on event")
	}
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	if event.EventType == "" {
		event.EventType = protocol.EventTypeMessage
	}

	// Calculate sequence number if not set
	if event.SequenceNum <= 0 {
		var maxSeq sql.NullInt64
		err := s.db.QueryRowContext(ctx, "SELECT MAX(sequence_num) FROM a2a_task_events WHERE task_id = $1", event.TaskID).Scan(&maxSeq)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("failed calculating next sequence number: %w", err)
		}
		if maxSeq.Valid {
			event.SequenceNum = int(maxSeq.Int64) + 1
		} else {
			event.SequenceNum = 1
		}
	}

	insertSQL := `
		INSERT INTO a2a_task_events (id, task_id, tenant_id, sequence_num, event_type, payload, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := s.db.ExecContext(ctx, insertSQL,
		event.ID,
		event.TaskID,
		event.TenantID,
		event.SequenceNum,
		event.EventType,
		string(event.Payload),
		event.Timestamp,
	)
	if err != nil {
		return fmt.Errorf("failed to append task event: %w", err)
	}

	// Broadcast to active live subscribers
	s.broadcastEvent(event)

	return nil
}

func (s *SQLStore) GetEvents(ctx context.Context, tenantID, taskID string, afterSeq int) ([]*protocol.TaskEvent, error) {
	if tenantID == "" || taskID == "" {
		return nil, nil
	}
	query := `
		SELECT id, task_id, tenant_id, sequence_num, event_type, payload, timestamp
		FROM a2a_task_events
		WHERE tenant_id = $1 AND task_id = $2 AND sequence_num > $3
		ORDER BY sequence_num ASC
	`
	rows, err := s.db.QueryContext(ctx, query, tenantID, taskID, afterSeq)
	if err != nil {
		return nil, fmt.Errorf("failed to query task events: %w", err)
	}
	defer rows.Close()

	var events []*protocol.TaskEvent
	for rows.Next() {
		var ev protocol.TaskEvent
		var payloadStr string
		err := rows.Scan(
			&ev.ID,
			&ev.TaskID,
			&ev.TenantID,
			&ev.SequenceNum,
			&ev.EventType,
			&payloadStr,
			&ev.Timestamp,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan task event: %w", err)
		}
		ev.Payload = json.RawMessage([]byte(payloadStr))
		events = append(events, &ev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error reading event rows: %w", err)
	}
	return events, nil
}

func (s *SQLStore) SubscribeEvents(ctx context.Context, tenantID, taskID string) (<-chan *protocol.TaskEvent, func(), error) {
	if tenantID == "" || taskID == "" {
		return nil, nil, ErrTaskNotFound
	}

	key := tenantID + ":" + taskID
	ch := make(chan *protocol.TaskEvent, 64)

	s.mu.Lock()
	s.subscribers[key] = append(s.subscribers[key], ch)
	s.mu.Unlock()

	unsubscribe := func() {
		s.mu.Lock()
		defer s.mu.Unlock()

		subs := s.subscribers[key]
		for i, sub := range subs {
			if sub == ch {
				s.subscribers[key] = append(subs[:i], subs[i+1:]...)
				close(ch)
				break
			}
		}
		if len(s.subscribers[key]) == 0 {
			delete(s.subscribers, key)
		}
	}

	return ch, unsubscribe, nil
}

func (s *SQLStore) broadcastEvent(event *protocol.TaskEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := event.TenantID + ":" + event.TaskID
	subs := s.subscribers[key]
	for _, ch := range subs {
		select {
		case ch <- event:
		default:
			// Dropped or channel full; subscriber is lagging
		}
	}
}

func scanTask(s rowScanner) (*protocol.Task, error) {
	var t protocol.Task
	var idempKey sql.NullString
	var deadline sql.NullTime
	var inputStr string
	var outputStr sql.NullString
	var errCode sql.NullString
	var errMsg sql.NullString
	var traceID sql.NullString

	err := s.Scan(
		&t.ID,
		&t.TenantID,
		&t.CallerClientID,
		&t.TargetAgentID,
		&idempKey,
		&t.Status,
		&deadline,
		&inputStr,
		&outputStr,
		&errCode,
		&errMsg,
		&traceID,
		&t.CreatedAt,
		&t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed scanning task: %w", err)
	}

	if idempKey.Valid {
		t.IdempotencyKey = idempKey.String
	}
	if deadline.Valid {
		t.Deadline = &deadline.Time
	}
	t.InputPayload = json.RawMessage([]byte(inputStr))
	if outputStr.Valid {
		t.OutputPayload = json.RawMessage([]byte(outputStr.String))
	}
	if errCode.Valid {
		t.ErrorCode = errCode.String
	}
	if errMsg.Valid {
		t.ErrorMessage = errMsg.String
	}
	if traceID.Valid {
		t.TraceID = traceID.String
	}

	return &t, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func isValidTransition(from, to string) bool {
	switch from {
	case protocol.StatusPending:
		return to == protocol.StatusRunning || to == protocol.StatusCancelled || to == protocol.StatusFailed
	case protocol.StatusRunning:
		return to == protocol.StatusCompleted || to == protocol.StatusFailed ||
			to == protocol.StatusTimedOut || to == protocol.StatusCancelled
	default:
		return false
	}
}

func jsonEqual(a, b []byte) bool {
	if bytes.Equal(a, b) {
		return true
	}
	var objA, objB any
	if err := json.Unmarshal(a, &objA); err != nil {
		return false
	}
	if err := json.Unmarshal(b, &objB); err != nil {
		return false
	}
	normA, _ := json.Marshal(objA)
	normB, _ := json.Marshal(objB)
	return bytes.Equal(normA, normB)
}
