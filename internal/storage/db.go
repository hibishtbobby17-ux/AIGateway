package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
	"project_alpha/internal/config"
)

// OpenDB initializes and returns a pooled SQL database handle.
// Supports both PostgreSQL ("pgx") and pure-Go SQLite ("sqlite") for testing/development.
func OpenDB(cfg *config.DatabaseConfig) (*sql.DB, error) {
	if cfg == nil {
		return nil, fmt.Errorf("database config cannot be nil")
	}

	driverName := strings.ToLower(cfg.Driver)
	dsn := cfg.URL

	switch driverName {
	case "sqlite":
		// Handle sqlite URL schemes: sqlite://path.db, file:memdb?mode=memory, or :memory:
		if strings.HasPrefix(dsn, "sqlite://") {
			dsn = strings.TrimPrefix(dsn, "sqlite://")
		}
		driverName = "sqlite"

	case "postgres", "":
		driverName = "pgx"

	default:
		return nil, fmt.Errorf("unsupported database driver %q: choose 'postgres' or 'sqlite'", cfg.Driver)
	}

	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database handle: %w", err)
	}

	// Configure connection pooling
	if driverName == "sqlite" && (dsn == ":memory:" || strings.Contains(dsn, "mode=memory")) {
		// In-memory SQLite requires max 1 open connection to retain schema and state across queries
		db.SetMaxOpenConns(1)
	} else {
		if cfg.MaxConns > 0 {
			db.SetMaxOpenConns(int(cfg.MaxConns))
		}
		if cfg.MinConns > 0 {
			db.SetMaxIdleConns(int(cfg.MinConns))
		}
		if cfg.MaxConnLifetime > 0 {
			db.SetConnMaxLifetime(cfg.MaxConnLifetime)
		}
		if cfg.MaxConnIdleTime > 0 {
			db.SetConnMaxIdleTime(cfg.MaxConnIdleTime)
		}
	}

	// Verify connectivity with a timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("database ping check failed for %s: %w", driverName, err)
	}

	return db, nil
}
