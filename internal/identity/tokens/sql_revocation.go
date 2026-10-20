package tokens

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type SQLRevocationStore struct {
	db *sql.DB
}

func NewSQLRevocationStore(db *sql.DB) (*SQLRevocationStore, error) {
	if db == nil {
		return nil, errors.New("token revocation SQL store requires a database")
	}
	return &SQLRevocationStore{db: db}, nil
}

func (s *SQLRevocationStore) Validate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "SELECT token_id_hash, expires_at FROM token_revocations WHERE 1 = 0"); err != nil {
		return fmt.Errorf("validate token revocation schema: %w", err)
	}
	return nil
}

func (s *SQLRevocationStore) Revoke(ctx context.Context, tokenID string, expiresAt time.Time) error {
	if tokenID == "" {
		return errors.New("token id is required for revocation")
	}
	if !expiresAt.After(time.Now()) {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, "DELETE FROM token_revocations WHERE expires_at <= $1", time.Now().UTC()); err != nil {
		return fmt.Errorf("prune expired token revocations: %w", err)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO token_revocations (token_id_hash, expires_at)
		VALUES ($1, $2)
		ON CONFLICT (token_id_hash) DO UPDATE SET expires_at = excluded.expires_at`,
		RevocationKey(tokenID), expiresAt.UTC(),
	)
	if err != nil {
		return fmt.Errorf("persist token revocation: %w", err)
	}
	return nil
}

func (s *SQLRevocationStore) CheckRevoked(ctx context.Context, tokenID string) (bool, error) {
	if tokenID == "" {
		return false, nil
	}
	var expiresAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT expires_at FROM token_revocations
		WHERE token_id_hash = $1`, RevocationKey(tokenID),
	).Scan(&expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("query token revocation: %w", err)
	}
	return expiresAt.After(time.Now()), nil
}
