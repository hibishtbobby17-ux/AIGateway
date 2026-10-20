-- 000010_telemetry.up.sql
-- Multi-tenant schema for OpenTelemetry traces and structured logs

CREATE TABLE IF NOT EXISTS telemetry_spans (
    span_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_span_id TEXT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'SERVER',
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration_ms REAL NOT NULL,
    status_code TEXT NOT NULL DEFAULT 'OK',
    status_message TEXT,
    attributes TEXT,
    events TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_spans_tenant_trace ON telemetry_spans(tenant_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_tenant_start ON telemetry_spans(tenant_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_spans_tenant_name ON telemetry_spans(tenant_id, name);

CREATE TABLE IF NOT EXISTS telemetry_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    trace_id TEXT,
    span_id TEXT,
    severity TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL,
    attributes TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_logs_tenant_time ON telemetry_logs(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_logs_tenant_trace ON telemetry_logs(tenant_id, trace_id);
