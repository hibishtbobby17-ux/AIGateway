CREATE TABLE IF NOT EXISTS token_revocations (
    token_id_hash TEXT PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_revocations_expiry
    ON token_revocations (expires_at);
