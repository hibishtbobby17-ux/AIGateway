CREATE TABLE IF NOT EXISTS oauth_sessions (
    token_type TEXT NOT NULL,
    signature TEXT NOT NULL,
    request_json TEXT NOT NULL,
    invalidated INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_type, signature)
);

CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expiry
    ON oauth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS oauth_client_assertion_jtis (
    jti TEXT PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_client_assertion_jtis_expiry
    ON oauth_client_assertion_jtis (expires_at);
