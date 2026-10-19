CREATE TABLE IF NOT EXISTS signing_keys (
    id TEXT PRIMARY KEY,
    algorithm TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signing_keys_single_active
    ON signing_keys(active) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_signing_keys_created_at
    ON signing_keys(created_at);
