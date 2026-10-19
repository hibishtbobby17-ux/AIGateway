package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"project_alpha/internal/tenants"
)

// SQLTenantRepository implements tenants.Repository using a standard *sql.DB handle.
type SQLTenantRepository struct {
	db *sql.DB
}

// NewSQLTenantRepository creates a new SQL-backed tenant repository.
func NewSQLTenantRepository(db *sql.DB) *SQLTenantRepository {
	return &SQLTenantRepository{db: db}
}

// CreateTenant inserts a new tenant record.
func (r *SQLTenantRepository) CreateTenant(ctx context.Context, t *tenants.Tenant) error {
	if t == nil {
		return fmt.Errorf("tenant cannot be nil")
	}
	now := time.Now().UTC()
	if t.CreatedAt.IsZero() {
		t.CreatedAt = now
	}
	if t.UpdatedAt.IsZero() {
		t.UpdatedAt = now
	}
	if t.Status == "" {
		t.Status = "ACTIVE"
	}
	if t.Tier == "" {
		t.Tier = "standard"
	}

	query := `
	INSERT INTO tenants (id, name, slug, status, tier, created_at, updated_at)
	VALUES ($1, $2, $3, $4, $5, $6, $7)`

	_, err := r.db.ExecContext(ctx, query, t.ID, t.Name, t.Slug, t.Status, t.Tier, t.CreatedAt, t.UpdatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return tenants.ErrDuplicateSlug
		}
		return fmt.Errorf("failed to create tenant: %w", err)
	}
	return nil
}

// GetTenantByID fetches a tenant by its primary key.
func (r *SQLTenantRepository) GetTenantByID(ctx context.Context, id string) (*tenants.Tenant, error) {
	query := `
	SELECT id, name, slug, status, tier, created_at, updated_at
	FROM tenants
	WHERE id = $1`

	t := &tenants.Tenant{}
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&t.ID, &t.Name, &t.Slug, &t.Status, &t.Tier, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, tenants.ErrTenantNotFound
		}
		return nil, fmt.Errorf("failed querying tenant by id: %w", err)
	}
	return t, nil
}

// GetTenantBySlug fetches a tenant by its unique URL slug.
func (r *SQLTenantRepository) GetTenantBySlug(ctx context.Context, slug string) (*tenants.Tenant, error) {
	query := `
	SELECT id, name, slug, status, tier, created_at, updated_at
	FROM tenants
	WHERE slug = $1`

	t := &tenants.Tenant{}
	err := r.db.QueryRowContext(ctx, query, slug).Scan(
		&t.ID, &t.Name, &t.Slug, &t.Status, &t.Tier, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, tenants.ErrTenantNotFound
		}
		return nil, fmt.Errorf("failed querying tenant by slug: %w", err)
	}
	return t, nil
}

// CreateProject inserts a new project scoped to a specific tenant.
func (r *SQLTenantRepository) CreateProject(ctx context.Context, p *tenants.Project) error {
	if p == nil {
		return fmt.Errorf("project cannot be nil")
	}
	if p.TenantID == "" {
		return fmt.Errorf("tenant_id is required for project creation")
	}
	now := time.Now().UTC()
	if p.CreatedAt.IsZero() {
		p.CreatedAt = now
	}
	if p.UpdatedAt.IsZero() {
		p.UpdatedAt = now
	}

	query := `
	INSERT INTO projects (id, tenant_id, name, slug, created_at, updated_at)
	VALUES ($1, $2, $3, $4, $5, $6)`

	_, err := r.db.ExecContext(ctx, query, p.ID, p.TenantID, p.Name, p.Slug, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return tenants.ErrDuplicateSlug
		}
		return fmt.Errorf("failed to create project: %w", err)
	}
	return nil
}

// GetProjectByID fetches a project strictly within the given tenant scope.
func (r *SQLTenantRepository) GetProjectByID(ctx context.Context, tenantID, id string) (*tenants.Project, error) {
	query := `
	SELECT id, tenant_id, name, slug, created_at, updated_at
	FROM projects
	WHERE tenant_id = $1 AND id = $2`

	p := &tenants.Project{}
	err := r.db.QueryRowContext(ctx, query, tenantID, id).Scan(
		&p.ID, &p.TenantID, &p.Name, &p.Slug, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, tenants.ErrProjectNotFound
		}
		return nil, fmt.Errorf("failed querying project: %w", err)
	}
	return p, nil
}

// ListProjects returns all projects belonging to the specified tenant.
func (r *SQLTenantRepository) ListProjects(ctx context.Context, tenantID string) ([]*tenants.Project, error) {
	query := `
	SELECT id, tenant_id, name, slug, created_at, updated_at
	FROM projects
	WHERE tenant_id = $1
	ORDER BY name ASC`

	rows, err := r.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed listing projects: %w", err)
	}
	defer rows.Close()

	var projectsList []*tenants.Project
	for rows.Next() {
		p := &tenants.Project{}
		if err := rows.Scan(&p.ID, &p.TenantID, &p.Name, &p.Slug, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed scanning project row: %w", err)
		}
		projectsList = append(projectsList, p)
	}
	return projectsList, rows.Err()
}
