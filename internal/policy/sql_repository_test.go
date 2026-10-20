package policy

import (
	"context"
	"testing"

	"project_alpha/internal/config"
	"project_alpha/internal/storage"
	"project_alpha/migrations"
)

func TestSQLRepositoryLoadsTenantScopedRules(t *testing.T) {
	ctx := context.Background()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO tenants (id, name, slug) VALUES ('tenant-1', 'Tenant One', 'tenant-one')`); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO policies
			(id, tenant_id, name, effect, actions, resources, roles, required_scopes, conditions)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		"policy-1", "tenant-1", "Allow tool read", "ALLOW",
		`["mcp:tools:call"]`, `["github::*"]`, `["tool-consumer"]`,
		`["mcp:tools:call"]`, `{"environment":"production"}`,
	); err != nil {
		t.Fatalf("insert policy: %v", err)
	}
	repository, err := NewSQLRepository(db)
	if err != nil {
		t.Fatalf("create SQL repository: %v", err)
	}
	engine, err := repository.LoadEngine(ctx)
	if err != nil {
		t.Fatalf("load policy engine: %v", err)
	}
	allowed := &Context{
		Subject: "user-1", TenantID: "tenant-1", Roles: []string{RoleToolConsumer},
		Scopes: []string{"mcp:tools:call"}, Action: ActionMCPToolsCall,
		Resource: "github::search", Attributes: map[string]any{"environment": "production"},
	}
	if !engine.IsAllowed(ctx, allowed) {
		t.Fatal("persisted policy did not authorize matching caller")
	}
	allowed.TenantID = "tenant-2"
	if engine.IsAllowed(ctx, allowed) {
		t.Fatal("persisted policy authorized a different tenant")
	}
}

func TestSQLRepositoryFailsOnMalformedPolicy(t *testing.T) {
	ctx := context.Background()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO tenants (id, name, slug) VALUES ('tenant-1', 'Tenant One', 'tenant-one')`); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO policies (id, tenant_id, name, effect, actions, resources)
		VALUES ('broken', 'tenant-1', 'Broken', 'ALLOW', 'not-json', '["*"]')`); err != nil {
		t.Fatalf("insert malformed policy: %v", err)
	}
	repository, err := NewSQLRepository(db)
	if err != nil {
		t.Fatalf("create SQL repository: %v", err)
	}
	if _, err := repository.LoadEngine(ctx); err == nil {
		t.Fatal("malformed persisted policy was silently ignored")
	}
}
