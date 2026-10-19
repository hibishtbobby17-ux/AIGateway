package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"strings"
	"time"
)

//go:embed *.sql
var MigrationFS embed.FS

// MigrateUp executes all up migrations in alphabetical/version sequence against db.
func MigrateUp(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("db cannot be nil")
	}

	// 1. Ensure migrations tracking table exists
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMP NOT NULL
	);`
	if _, err := db.ExecContext(ctx, createTableSQL); err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	// 2. Read migration files
	entries, err := MigrationFS.ReadDir(".")
	if err != nil {
		return fmt.Errorf("failed to read embedded migrations: %w", err)
	}

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}

		version := strings.TrimSuffix(name, ".up.sql")

		// Check if already applied
		var exists int
		err := db.QueryRowContext(ctx, "SELECT COUNT(1) FROM schema_migrations WHERE version = $1", version).Scan(&exists)
		if err != nil {
			// Try SQLite positional ? parameter if $1 fails
			err = db.QueryRowContext(ctx, "SELECT COUNT(1) FROM schema_migrations WHERE version = ?", version).Scan(&exists)
		}
		if err == nil && exists > 0 {
			continue // Already applied
		}

		// Read and execute migration script
		content, err := MigrationFS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", name, err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("failed to begin migration transaction for %s: %w", name, err)
		}

		// Execute statements
		queries := splitSQLStatements(string(content))
		for _, q := range queries {
			q = strings.TrimSpace(q)
			if q == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, q); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("failed executing migration %s query [%s]: %w", name, q, err)
			}
		}

		// Record migration version
		recordSQL := "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)"
		if _, err := tx.ExecContext(ctx, recordSQL, version, time.Now().UTC()); err != nil {
			// Fallback to SQLite ? syntax
			recordSQL = "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
			if _, err := tx.ExecContext(ctx, recordSQL, version, time.Now().UTC()); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("failed to record applied migration %s: %w", version, err)
			}
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit migration transaction for %s: %w", name, err)
		}
	}

	return nil
}

// MigrateDown executes the rollback down migration.
func MigrateDown(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("db cannot be nil")
	}

	var version string
	err := db.QueryRowContext(ctx, "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return fmt.Errorf("failed to read latest schema migration: %w", err)
	}

	filename := version + ".down.sql"
	content, err := MigrationFS.ReadFile(filename)
	if err != nil {
		return fmt.Errorf("failed to read down migration %s: %w", filename, err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin rollback transaction: %w", err)
	}

	queries := splitSQLStatements(string(content))
	for _, q := range queries {
		q = strings.TrimSpace(q)
		if q == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, q); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed executing down query [%s]: %w", q, err)
		}
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = $1", version); err != nil {
		if _, fallbackErr := tx.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = ?", version); fallbackErr != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed to remove rolled back migration %s: %w", version, fallbackErr)
		}
	}

	return tx.Commit()
}

func splitSQLStatements(sql string) []string {
	var statements []string
	raw := strings.Split(sql, ";")
	for _, s := range raw {
		trimmed := strings.TrimSpace(s)
		if trimmed != "" {
			statements = append(statements, trimmed)
		}
	}
	return statements
}
