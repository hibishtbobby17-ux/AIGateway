package keys

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type SQLRepository struct {
	db *sql.DB
}

func NewSQLRepository(db *sql.DB) (*SQLRepository, error) {
	if db == nil {
		return nil, errors.New("signing key SQL repository requires a database")
	}
	return &SQLRepository{db: db}, nil
}

func (r *SQLRepository) LoadKeys(ctx context.Context) ([]StoredKey, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, algorithm, encrypted_private_key, created_at, active
		FROM signing_keys
		ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("query persisted signing keys: %w", err)
	}
	defer rows.Close()

	var keys []StoredKey
	for rows.Next() {
		var key StoredKey
		if err := rows.Scan(&key.ID, &key.Algorithm, &key.EncryptedPrivateKey, &key.CreatedAt, &key.Active); err != nil {
			return nil, fmt.Errorf("scan persisted signing key: %w", err)
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate persisted signing keys: %w", err)
	}
	return keys, nil
}

func (r *SQLRepository) ActivateKey(ctx context.Context, key StoredKey) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin signing key rotation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "UPDATE signing_keys SET active = FALSE WHERE active = TRUE"); err != nil {
		return fmt.Errorf("deactivate previous signing key: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO signing_keys (id, algorithm, encrypted_private_key, created_at, active)
		VALUES ($1, $2, $3, $4, TRUE)`,
		key.ID, key.Algorithm, key.EncryptedPrivateKey, key.CreatedAt,
	); err != nil {
		return fmt.Errorf("insert active signing key: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit signing key rotation: %w", err)
	}
	return nil
}
