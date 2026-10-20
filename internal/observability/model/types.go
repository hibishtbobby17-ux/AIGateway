package model

import "time"

// Standard OpenTelemetry Span Kinds.
const (
	SpanKindServer   = "SERVER"
	SpanKindClient   = "CLIENT"
	SpanKindInternal = "INTERNAL"
	SpanKindProducer = "PRODUCER"
	SpanKindConsumer = "CONSUMER"
)

// Standard OpenTelemetry Status Codes.
const (
	StatusCodeUnset = "UNSET"
	StatusCodeOk    = "OK"
	StatusCodeError = "ERROR"
)

// SpanEvent represents an annotated timestamped milestone on a span.
type SpanEvent struct {
	Name       string         `json:"name"`
	Timestamp  time.Time      `json:"timestamp"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// Span represents an OpenTelemetry-compatible span.
type Span struct {
	SpanID        string         `json:"span_id"`
	TraceID       string         `json:"trace_id"`
	ParentSpanID  string         `json:"parent_span_id,omitempty"`
	TenantID      string         `json:"tenant_id"`
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	StartTime     time.Time      `json:"start_time"`
	EndTime       time.Time      `json:"end_time"`
	DurationMs    float64        `json:"duration_ms"`
	StatusCode    string         `json:"status_code"`
	StatusMessage string         `json:"status_message,omitempty"`
	Attributes    map[string]any `json:"attributes,omitempty"`
	Events        []SpanEvent    `json:"events,omitempty"`
}

// LogRecord represents a structured application or gateway log record correlated with trace context.
type LogRecord struct {
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id"`
	TraceID    string         `json:"trace_id,omitempty"`
	SpanID     string         `json:"span_id,omitempty"`
	Severity   string         `json:"severity"` // DEBUG, INFO, WARN, ERROR, FATAL
	Message    string         `json:"message"`
	Attributes map[string]any `json:"attributes,omitempty"`
	Timestamp  time.Time      `json:"timestamp"`
}

// MetricData represents a multi-tenant metric measurement.
type MetricData struct {
	Name      string            `json:"name"`
	Type      string            `json:"type"` // COUNTER, GAUGE, HISTOGRAM
	TenantID  string            `json:"tenant_id"`
	Value     float64           `json:"value"`
	Labels    map[string]string `json:"labels,omitempty"`
	Timestamp time.Time         `json:"timestamp"`
}
