package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"project_alpha/internal/observability/model"
)

var (
	ErrSpanNotFound = errors.New("span not found")
	ErrTraceNotFound = errors.New("trace not found")
)

// TraceFilter defines parameters for searching stored spans.
type TraceFilter struct {
	TenantID      string
	TraceID       string
	Name          string
	StatusCode    string
	StartTime     time.Time
	EndTime       time.Time
	Limit         int
}

// LogFilter defines parameters for searching structured logs.
type LogFilter struct {
	TenantID  string
	TraceID   string
	Severity  string
	StartTime time.Time
	EndTime   time.Time
	Limit     int
}

// TraceStore persists and queries distributed traces.
type TraceStore interface {
	StoreSpans(ctx context.Context, spans []*model.Span) error
	QuerySpans(ctx context.Context, filter TraceFilter) ([]*model.Span, error)
	GetTrace(ctx context.Context, tenantID, traceID string) ([]*model.Span, error)
}

// LogStore persists and queries structured logs.
type LogStore interface {
	StoreLogs(ctx context.Context, logs []*model.LogRecord) error
	QueryLogs(ctx context.Context, filter LogFilter) ([]*model.LogRecord, error)
}

// SQLTraceStore implements TraceStore backed by SQLite or PostgreSQL.
type SQLTraceStore struct {
	db *sql.DB
}

// NewSQLTraceStore creates a new SQLTraceStore.
func NewSQLTraceStore(db *sql.DB) *SQLTraceStore {
	return &SQLTraceStore{db: db}
}

func (s *SQLTraceStore) StoreSpans(ctx context.Context, spans []*model.Span) error {
	if len(spans) == 0 {
		return nil
	}

	query := `
		INSERT INTO telemetry_spans (
			span_id, trace_id, parent_span_id, tenant_id, name,
			kind, start_time, end_time, duration_ms, status_code,
			status_message, attributes, events
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`
	for _, span := range spans {
		if span == nil || span.SpanID == "" {
			continue
		}
		tenantID := span.TenantID
		if tenantID == "" {
			tenantID = "default"
		}
		var parentID *string
		if span.ParentSpanID != "" {
			parentID = &span.ParentSpanID
		}
		attrsJSON, _ := json.Marshal(span.Attributes)
		eventsJSON, _ := json.Marshal(span.Events)

		_, err := s.db.ExecContext(ctx, query,
			span.SpanID,
			span.TraceID,
			parentID,
			tenantID,
			span.Name,
			span.Kind,
			span.StartTime,
			span.EndTime,
			span.DurationMs,
			span.StatusCode,
			span.StatusMessage,
			string(attrsJSON),
			string(eventsJSON),
		)
		if err != nil {
			return fmt.Errorf("failed inserting span %s: %w", span.SpanID, err)
		}
	}
	return nil
}

func (s *SQLTraceStore) QuerySpans(ctx context.Context, filter TraceFilter) ([]*model.Span, error) {
	if filter.TenantID == "" {
		return nil, nil
	}
	limit := filter.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT span_id, trace_id, parent_span_id, tenant_id, name,
		       kind, start_time, end_time, duration_ms, status_code,
		       status_message, attributes, events
		FROM telemetry_spans
		WHERE tenant_id = $1
	`
	args := []any{filter.TenantID}
	argIdx := 2

	if filter.TraceID != "" {
		query += fmt.Sprintf(" AND trace_id = $%d", argIdx)
		args = append(args, filter.TraceID)
		argIdx++
	}
	if filter.Name != "" {
		query += fmt.Sprintf(" AND name = $%d", argIdx)
		args = append(args, filter.Name)
		argIdx++
	}
	if filter.StatusCode != "" {
		query += fmt.Sprintf(" AND status_code = $%d", argIdx)
		args = append(args, filter.StatusCode)
		argIdx++
	}
	if !filter.StartTime.IsZero() {
		query += fmt.Sprintf(" AND start_time >= $%d", argIdx)
		args = append(args, filter.StartTime)
		argIdx++
	}
	if !filter.EndTime.IsZero() {
		query += fmt.Sprintf(" AND end_time <= $%d", argIdx)
		args = append(args, filter.EndTime)
		argIdx++
	}

	query += fmt.Sprintf(" ORDER BY start_time DESC LIMIT $%d", argIdx)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed querying spans: %w", err)
	}
	defer rows.Close()

	var result []*model.Span
	for rows.Next() {
		span, err := scanSpan(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, span)
	}
	return result, nil
}

func (s *SQLTraceStore) GetTrace(ctx context.Context, tenantID, traceID string) ([]*model.Span, error) {
	if tenantID == "" || traceID == "" {
		return nil, ErrTraceNotFound
	}

	query := `
		SELECT span_id, trace_id, parent_span_id, tenant_id, name,
		       kind, start_time, end_time, duration_ms, status_code,
		       status_message, attributes, events
		FROM telemetry_spans
		WHERE tenant_id = $1 AND trace_id = $2
		ORDER BY start_time ASC
	`
	rows, err := s.db.QueryContext(ctx, query, tenantID, traceID)
	if err != nil {
		return nil, fmt.Errorf("failed fetching trace: %w", err)
	}
	defer rows.Close()

	var spans []*model.Span
	for rows.Next() {
		span, err := scanSpan(rows)
		if err != nil {
			return nil, err
		}
		spans = append(spans, span)
	}
	if len(spans) == 0 {
		return nil, ErrTraceNotFound
	}
	return spans, nil
}

func scanSpan(scanner interface{ Scan(...any) error }) (*model.Span, error) {
	var s model.Span
	var parentID sql.NullString
	var statusMsg sql.NullString
	var attrsJSON sql.NullString
	var eventsJSON sql.NullString

	err := scanner.Scan(
		&s.SpanID,
		&s.TraceID,
		&parentID,
		&s.TenantID,
		&s.Name,
		&s.Kind,
		&s.StartTime,
		&s.EndTime,
		&s.DurationMs,
		&s.StatusCode,
		&statusMsg,
		&attrsJSON,
		&eventsJSON,
	)
	if err != nil {
		return nil, err
	}

	if parentID.Valid {
		s.ParentSpanID = parentID.String
	}
	if statusMsg.Valid {
		s.StatusMessage = statusMsg.String
	}
	if attrsJSON.Valid && attrsJSON.String != "" {
		_ = json.Unmarshal([]byte(attrsJSON.String), &s.Attributes)
	}
	if eventsJSON.Valid && eventsJSON.String != "" {
		_ = json.Unmarshal([]byte(eventsJSON.String), &s.Events)
	}
	return &s, nil
}

// SQLLogStore implements LogStore backed by SQLite or PostgreSQL.
type SQLLogStore struct {
	db *sql.DB
}

// NewSQLLogStore creates a new SQLLogStore.
func NewSQLLogStore(db *sql.DB) *SQLLogStore {
	return &SQLLogStore{db: db}
}

func (s *SQLLogStore) StoreLogs(ctx context.Context, logs []*model.LogRecord) error {
	if len(logs) == 0 {
		return nil
	}
	query := `
		INSERT INTO telemetry_logs (id, tenant_id, trace_id, span_id, severity, message, attributes, timestamp)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	for _, l := range logs {
		if l == nil || l.ID == "" {
			continue
		}
		tenantID := l.TenantID
		if tenantID == "" {
			tenantID = "default"
		}
		attrsJSON, _ := json.Marshal(l.Attributes)
		_, err := s.db.ExecContext(ctx, query,
			l.ID,
			tenantID,
			l.TraceID,
			l.SpanID,
			l.Severity,
			l.Message,
			string(attrsJSON),
			l.Timestamp,
		)
		if err != nil {
			return fmt.Errorf("failed inserting log %s: %w", l.ID, err)
		}
	}
	return nil
}

func (s *SQLLogStore) QueryLogs(ctx context.Context, filter LogFilter) ([]*model.LogRecord, error) {
	if filter.TenantID == "" {
		return nil, nil
	}
	limit := filter.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT id, tenant_id, trace_id, span_id, severity, message, attributes, timestamp
		FROM telemetry_logs
		WHERE tenant_id = $1
	`
	args := []any{filter.TenantID}
	argIdx := 2

	if filter.TraceID != "" {
		query += fmt.Sprintf(" AND trace_id = $%d", argIdx)
		args = append(args, filter.TraceID)
		argIdx++
	}
	if filter.Severity != "" {
		query += fmt.Sprintf(" AND severity = $%d", argIdx)
		args = append(args, filter.Severity)
		argIdx++
	}
	if !filter.StartTime.IsZero() {
		query += fmt.Sprintf(" AND timestamp >= $%d", argIdx)
		args = append(args, filter.StartTime)
		argIdx++
	}
	if !filter.EndTime.IsZero() {
		query += fmt.Sprintf(" AND timestamp <= $%d", argIdx)
		args = append(args, filter.EndTime)
		argIdx++
	}

	query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT $%d", argIdx)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed querying logs: %w", err)
	}
	defer rows.Close()

	var logs []*model.LogRecord
	for rows.Next() {
		var l model.LogRecord
		var traceID, spanID, attrsJSON sql.NullString
		err := rows.Scan(&l.ID, &l.TenantID, &traceID, &spanID, &l.Severity, &l.Message, &attrsJSON, &l.Timestamp)
		if err != nil {
			return nil, err
		}
		if traceID.Valid {
			l.TraceID = traceID.String
		}
		if spanID.Valid {
			l.SpanID = spanID.String
		}
		if attrsJSON.Valid && attrsJSON.String != "" {
			_ = json.Unmarshal([]byte(attrsJSON.String), &l.Attributes)
		}
		logs = append(logs, &l)
	}
	return logs, nil
}

// MemoryStore implements both TraceStore and LogStore using an in-memory ring buffer.
type MemoryStore struct {
	mu       sync.RWMutex
	capacity int
	spans    []*model.Span
	logs     []*model.LogRecord
}

// NewMemoryStore creates an in-memory telemetry store with bounded capacity.
func NewMemoryStore(capacity int) *MemoryStore {
	if capacity <= 0 {
		capacity = 1000
	}
	return &MemoryStore{
		capacity: capacity,
		spans:    make([]*model.Span, 0, capacity),
		logs:     make([]*model.LogRecord, 0, capacity),
	}
}

func (m *MemoryStore) StoreSpans(ctx context.Context, spans []*model.Span) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, s := range spans {
		if len(m.spans) >= m.capacity {
			// Evict oldest
			m.spans = m.spans[1:]
		}
		m.spans = append(m.spans, s)
	}
	return nil
}

func (m *MemoryStore) QuerySpans(ctx context.Context, filter TraceFilter) ([]*model.Span, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*model.Span
	for i := len(m.spans) - 1; i >= 0; i-- {
		s := m.spans[i]
		if s.TenantID != filter.TenantID {
			continue
		}
		if filter.TraceID != "" && s.TraceID != filter.TraceID {
			continue
		}
		if filter.Name != "" && s.Name != filter.Name {
			continue
		}
		if filter.StatusCode != "" && s.StatusCode != filter.StatusCode {
			continue
		}
		result = append(result, s)
		if filter.Limit > 0 && len(result) >= filter.Limit {
			break
		}
	}
	return result, nil
}

func (m *MemoryStore) GetTrace(ctx context.Context, tenantID, traceID string) ([]*model.Span, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var traceSpans []*model.Span
	for _, s := range m.spans {
		if s.TenantID == tenantID && s.TraceID == traceID {
			traceSpans = append(traceSpans, s)
		}
	}
	if len(traceSpans) == 0 {
		return nil, ErrTraceNotFound
	}
	return traceSpans, nil
}

func (m *MemoryStore) StoreLogs(ctx context.Context, logs []*model.LogRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, l := range logs {
		if len(m.logs) >= m.capacity {
			m.logs = m.logs[1:]
		}
		m.logs = append(m.logs, l)
	}
	return nil
}

func (m *MemoryStore) QueryLogs(ctx context.Context, filter LogFilter) ([]*model.LogRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*model.LogRecord
	for i := len(m.logs) - 1; i >= 0; i-- {
		l := m.logs[i]
		if l.TenantID != filter.TenantID {
			continue
		}
		if filter.TraceID != "" && l.TraceID != filter.TraceID {
			continue
		}
		if filter.Severity != "" && l.Severity != filter.Severity {
			continue
		}
		result = append(result, l)
		if filter.Limit > 0 && len(result) >= filter.Limit {
			break
		}
	}
	return result, nil
}
