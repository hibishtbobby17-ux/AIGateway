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

// TopologyNode represents a node in either configured or observed topology graphs.
type TopologyNode struct {
	ID           string         `json:"id"`
	Label        string         `json:"label"`
	Type         string         `json:"type"`   // "gateway", "mcp_server", "agent", "client", "service"
	Status       string         `json:"status"` // "HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"
	CallCount    int64          `json:"call_count"`
	ErrorCount   int64          `json:"error_count"`
	AvgLatencyMs float64        `json:"avg_latency_ms"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// TopologyEdge represents a connection or interaction between two nodes.
type TopologyEdge struct {
	ID             string    `json:"id"`
	Source         string    `json:"source"`
	Target         string    `json:"target"`
	Protocol       string    `json:"protocol"` // "mcp", "a2a", "http"
	CallCount      int64     `json:"call_count"`
	ErrorCount     int64     `json:"error_count"`
	AvgLatencyMs   float64   `json:"avg_latency_ms"`
	P95LatencyMs   float64   `json:"p95_latency_ms"`
	LastSeen       time.Time `json:"last_seen"`
	SampleTraceIDs []string  `json:"sample_trace_ids,omitempty"`
}

// ConfiguredTopology represents the static registered topology of the platform.
type ConfiguredTopology struct {
	TenantID string         `json:"tenant_id"`
	Nodes    []TopologyNode `json:"nodes"`
	Edges    []TopologyEdge `json:"edges"`
}

// ObservedTopology represents aggregated runtime interaction topology over a time window.
type ObservedTopology struct {
	TenantID       string         `json:"tenant_id"`
	TimeRangeStart time.Time      `json:"time_range_start"`
	TimeRangeEnd   time.Time      `json:"time_range_end"`
	Nodes          []TopologyNode `json:"nodes"`
	Edges          []TopologyEdge `json:"edges"`
	TotalCalls     int64          `json:"total_calls"`
	TotalErrors    int64          `json:"total_errors"`
}

// TraceSummary represents high-level metrics and root span info for a trace in search lists.
type TraceSummary struct {
	TraceID       string    `json:"trace_id"`
	TenantID      string    `json:"tenant_id"`
	RootSpanName  string    `json:"root_span_name"`
	StartTime     time.Time `json:"start_time"`
	DurationMs    float64   `json:"duration_ms"`
	SpanCount     int       `json:"span_count"`
	StatusCode    string    `json:"status_code"`
	StatusMessage string    `json:"status_message,omitempty"`
}

// MetricsSummary represents high-level aggregated operational metrics for a tenant dashboard.
type MetricsSummary struct {
	TenantID         string           `json:"tenant_id"`
	TimeRangeStart   time.Time        `json:"time_range_start"`
	TimeRangeEnd     time.Time        `json:"time_range_end"`
	TotalRequests    int64            `json:"total_requests"`
	TotalErrors      int64            `json:"total_errors"`
	ErrorRatePercent float64          `json:"error_rate_percent"`
	AvgLatencyMs     float64          `json:"avg_latency_ms"`
	P95LatencyMs     float64          `json:"p95_latency_ms"`
	ActiveMCPServers int              `json:"active_mcp_servers"`
	ActiveAgents     int              `json:"active_agents"`
	TopTools         map[string]int64 `json:"top_tools"`
	TaskStatusCounts map[string]int64 `json:"task_status_counts"`
}

