-- 000009_a2a_task_events.up.sql
-- Multi-tenant A2A task event history for streaming and durability

CREATE TABLE IF NOT EXISTS a2a_task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES a2a_tasks(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sequence_num INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, sequence_num)
);

CREATE INDEX IF NOT EXISTS idx_a2a_task_events_task ON a2a_task_events(task_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_a2a_task_events_tenant ON a2a_task_events(tenant_id);
