package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	"project_alpha/internal/config"
	"project_alpha/internal/tenants"
	"project_alpha/migrations"
)

func TestSQLiteDatabaseMigrationsAndRepository(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Open lightweight in-memory SQLite database
	cfg := &config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	}

	db, err := OpenDB(cfg)
	if err != nil {
		t.Fatalf("failed to open in-memory sqlite db: %v", err)
	}
	defer db.Close()

	// 2. Execute Up Migrations
	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running MigrateUp: %v", err)
	}

	// 3. Test Repository operations
	repo := NewSQLTenantRepository(db)

	tenantA := &tenants.Tenant{
		ID:   "tenant-001",
		Name: "Acme Corp",
		Slug: "acme",
		Tier: "enterprise",
	}

	if err := repo.CreateTenant(ctx, tenantA); err != nil {
		t.Fatalf("failed creating tenant: %v", err)
	}

	// Test Get by ID
	fetched, err := repo.GetTenantByID(ctx, "tenant-001")
	if err != nil {
		t.Fatalf("failed fetching tenant by ID: %v", err)
	}
	if fetched.Name != "Acme Corp" || fetched.Slug != "acme" {
		t.Errorf("unexpected tenant details: %+v", fetched)
	}

	// Test Get by Slug
	bySlug, err := repo.GetTenantBySlug(ctx, "acme")
	if err != nil {
		t.Fatalf("failed fetching tenant by Slug: %v", err)
	}
	if bySlug.ID != "tenant-001" {
		t.Errorf("expected tenant ID tenant-001, got: %s", bySlug.ID)
	}

	// Test Duplicate Slug rejection
	duplicate := &tenants.Tenant{
		ID:   "tenant-002",
		Name: "Acme Duplicate",
		Slug: "acme",
	}
	if err := repo.CreateTenant(ctx, duplicate); !errors.Is(err, tenants.ErrDuplicateSlug) {
		t.Fatalf("expected ErrDuplicateSlug, got: %v", err)
	}

	// 4. Test Project creation & Tenant Isolation
	tenantB := &tenants.Tenant{
		ID:   "tenant-002",
		Name: "Beta LLC",
		Slug: "beta",
	}
	if err := repo.CreateTenant(ctx, tenantB); err != nil {
		t.Fatalf("failed creating tenant B: %v", err)
	}

	projA := &tenants.Project{
		ID:       "proj-a1",
		TenantID: tenantA.ID,
		Name:     "Acme Production",
		Slug:     "prod",
	}
	if err := repo.CreateProject(ctx, projA); err != nil {
		t.Fatalf("failed creating project: %v", err)
	}

	// Verify Tenant A can fetch its project
	fetchedProj, err := repo.GetProjectByID(ctx, tenantA.ID, projA.ID)
	if err != nil {
		t.Fatalf("expected tenant A to retrieve its project: %v", err)
	}
	if fetchedProj.Name != "Acme Production" {
		t.Errorf("unexpected project name: %s", fetchedProj.Name)
	}

	// Critical Tenant Isolation Test: Tenant B MUST NOT be able to fetch Tenant A's project
	_, err = repo.GetProjectByID(ctx, tenantB.ID, projA.ID)
	if !errors.Is(err, tenants.ErrProjectNotFound) {
		t.Fatalf("security violation: tenant B was able to access tenant A's project! err: %v", err)
	}

	// Verify ListProjects tenant scoping
	projListA, err := repo.ListProjects(ctx, tenantA.ID)
	if err != nil || len(projListA) != 1 {
		t.Fatalf("expected 1 project for tenant A, got: %d (err: %v)", len(projListA), err)
	}
	projListB, err := repo.ListProjects(ctx, tenantB.ID)
	if err != nil || len(projListB) != 0 {
		t.Fatalf("expected 0 projects for tenant B, got: %d (err: %v)", len(projListB), err)
	}

	// 5. Test Rollback (MigrateDown)
	if err := migrations.MigrateDown(ctx, db); err != nil {
		t.Fatalf("failed rolling back token revocation migration: %v", err)
	}
	if err := migrations.MigrateDown(ctx, db); err != nil {
		t.Fatalf("failed rolling back OAuth consent migration: %v", err)
	}
	if err := migrations.MigrateDown(ctx, db); err != nil {
		t.Fatalf("failed rolling back signing key migration: %v", err)
	}
	if err := migrations.MigrateDown(ctx, db); err != nil {
		t.Fatalf("failed rolling back OAuth migration: %v", err)
	}
	if err := migrations.MigrateDown(ctx, db); err != nil {
		t.Fatalf("failed rolling back initial migration: %v", err)
	}
}
