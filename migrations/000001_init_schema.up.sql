-- 000001_init_schema.up.sql
-- Multi-tenant schema compatible with PostgreSQL and SQLite

CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    tier TEXT NOT NULL DEFAULT 'standard',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS oauth_clients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL UNIQUE,
    client_secret_hash TEXT,
    client_type TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
    allowed_grant_types TEXT NOT NULL,
    redirect_uris TEXT,
    allowed_scopes TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    effect TEXT NOT NULL DEFAULT 'ALLOW',
    actions TEXT NOT NULL,
    resources TEXT NOT NULL,
    conditions TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    namespace_prefix TEXT NOT NULL,
    transport_type TEXT NOT NULL DEFAULT 'SSE',
    endpoint_url TEXT,
    command TEXT,
    auth_type TEXT NOT NULL DEFAULT 'NONE',
    encrypted_auth_credentials BYTEA,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    concurrency_limit INTEGER NOT NULL DEFAULT 50,
    health_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    agent_card TEXT NOT NULL,
    protocol_version TEXT NOT NULL DEFAULT 'a2a/v1',
    auth_type TEXT NOT NULL DEFAULT 'NONE',
    encrypted_auth_credentials BYTEA,
    health_status TEXT NOT NULL DEFAULT 'HEALTHY',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS a2a_tasks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    caller_client_id TEXT NOT NULL,
    target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    idempotency_key TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    deadline TIMESTAMP,
    input_payload TEXT NOT NULL,
    output_payload TEXT,
    error_code TEXT,
    error_message TEXT,
    trace_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'USER',
    action TEXT NOT NULL,
    resource_id TEXT,
    outcome TEXT NOT NULL DEFAULT 'SUCCESS',
    client_ip TEXT,
    user_agent TEXT,
    trace_id TEXT,
    metadata TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Composite multi-tenant performance indexes
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON mcp_servers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_tenant ON a2a_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status ON a2a_tasks(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, timestamp);
