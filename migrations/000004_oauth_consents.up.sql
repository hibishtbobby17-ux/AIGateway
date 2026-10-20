CREATE TABLE IF NOT EXISTS oauth_consents (
    tenant_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    scopes TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, subject, client_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_consents_client
    ON oauth_consents (tenant_id, client_id);
