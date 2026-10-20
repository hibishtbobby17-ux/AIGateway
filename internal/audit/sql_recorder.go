package audit

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrTenantRequired = errors.New("tenant_id is strictly required for audit operations")
	ErrActorRequired  = errors.New("actor_id is strictly required for audit operations")
	ErrActionRequired = errors.New("action is strictly required for audit operations")
)

// SQLRecorder implements Recorder using an SQL database.
type SQLRecorder struct {
	db *sql.DB
}

// NewSQLRecorder creates a new SQL audit recorder.
func NewSQLRecorder(db *sql.DB) *SQLRecorder {
	return &SQLRecorder{db: db}
}

// Record persists an audit event to the audit_logs table.
func (r *SQLRecorder) Record(ctx context.Context, e Event) error {
	if r.db == nil {
		return errors.New("audit recorder has no database connection")
	}
	if e.TenantID == "" {
		return ErrTenantRequired
	}
	if e.ActorID == "" {
		return ErrActorRequired
	}
	if e.Action == "" {
		return ErrActionRequired
	}

	if e.ID == "" {
		idBytes := make([]byte, 16)
		if _, err := rand.Read(idBytes); err != nil {
			return fmt.Errorf("failed generating audit event id: %w", err)
		}
		e.ID = hex.EncodeToString(idBytes)
	}

	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	if e.Outcome == "" {
		e.Outcome = OutcomeSuccess
	}
	if e.ActorType == "" {
		e.ActorType = ActorTypeUser
	}

	metadataJSON := "{}"
	if len(e.Metadata) > 0 {
		data, err := json.Marshal(e.Metadata)
		if err != nil {
			return fmt.Errorf("failed marshaling audit metadata: %w", err)
		}
		metadataJSON = string(data)
	}

	query := `
	INSERT INTO audit_logs (
		id, tenant_id, actor_id, actor_type, action, resource_id,
		outcome, client_ip, user_agent, trace_id, metadata, timestamp
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`

	_, err := r.db.ExecContext(
		ctx,
		query,
		e.ID,
		e.TenantID,
		e.ActorID,
		e.ActorType,
		e.Action,
		e.ResourceID,
		e.Outcome,
		e.ClientIP,
		e.UserAgent,
		e.TraceID,
		metadataJSON,
		e.Timestamp,
	)
	if err != nil {
		return fmt.Errorf("failed to record audit log: %w", err)
	}

	return nil
}

// Query retrieves audit events matching filter criteria with mandatory tenant isolation.
func (r *SQLRecorder) Query(ctx context.Context, f Filter) ([]Event, error) {
	if r.db == nil {
		return nil, errors.New("audit recorder has no database connection")
	}
	if f.TenantID == "" {
		return nil, ErrTenantRequired
	}

	var conditions []string
	var args []any
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("tenant_id = $%d", argIdx))
	args = append(args, f.TenantID)
	argIdx++

	if f.ActorID != "" {
		conditions = append(conditions, fmt.Sprintf("actor_id = $%d", argIdx))
		args = append(args, f.ActorID)
		argIdx++
	}
	if f.Action != "" {
		conditions = append(conditions, fmt.Sprintf("action = $%d", argIdx))
		args = append(args, f.Action)
		argIdx++
	}
	if f.Outcome != "" {
		conditions = append(conditions, fmt.Sprintf("outcome = $%d", argIdx))
		args = append(args, f.Outcome)
		argIdx++
	}
	if !f.StartTime.IsZero() {
		conditions = append(conditions, fmt.Sprintf("timestamp >= $%d", argIdx))
		args = append(args, f.StartTime)
		argIdx++
	}
	if !f.EndTime.IsZero() {
		conditions = append(conditions, fmt.Sprintf("timestamp <= $%d", argIdx))
		args = append(args, f.EndTime)
		argIdx++
	}

	limit := f.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	query := fmt.Sprintf(`
	SELECT id, tenant_id, actor_id, actor_type, action, COALESCE(resource_id, ''),
	       outcome, COALESCE(client_ip, ''), COALESCE(user_agent, ''), COALESCE(trace_id, ''),
	       COALESCE(metadata, '{}'), timestamp
	FROM audit_logs
	WHERE %s
	ORDER BY timestamp DESC
	LIMIT $%d`, strings.Join(conditions, " AND "), argIdx)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed querying audit logs: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		var metaStr string
		err := rows.Scan(
			&e.ID,
			&e.TenantID,
			&e.ActorID,
			&e.ActorType,
			&e.Action,
			&e.ResourceID,
			&e.Outcome,
			&e.ClientIP,
			&e.UserAgent,
			&e.TraceID,
			&metaStr,
			&e.Timestamp,
		)
		if err != nil {
			return nil, fmt.Errorf("failed scanning audit row: %w", err)
		}

		if metaStr != "" && metaStr != "{}" {
			var meta map[string]any
			if err := json.Unmarshal([]byte(metaStr), &meta); err == nil {
				e.Metadata = meta
			}
		}

		events = append(events, e)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error during audit query: %w", err)
	}

	return events, nil
}
