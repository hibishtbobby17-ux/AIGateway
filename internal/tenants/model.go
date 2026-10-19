package tenants

import (
	"context"
	"errors"
	"time"
)

var (
	ErrTenantNotFound  = errors.New("tenant not found")
	ErrProjectNotFound = errors.New("project not found")
	ErrDuplicateSlug   = errors.New("slug already in use")
)

// Tenant represents an isolated tenant organization.
type Tenant struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Status    string    `json:"status"` // ACTIVE, SUSPENDED, DELETED
	Tier      string    `json:"tier"`   // standard, enterprise
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Project represents an environment or team workspace scoped to a tenant.
type Project struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Repository defines the contract for tenant and project persistence.
type Repository interface {
	CreateTenant(ctx context.Context, tenant *Tenant) error
	GetTenantByID(ctx context.Context, id string) (*Tenant, error)
	GetTenantBySlug(ctx context.Context, slug string) (*Tenant, error)

	CreateProject(ctx context.Context, project *Project) error
	GetProjectByID(ctx context.Context, tenantID, id string) (*Project, error)
	ListProjects(ctx context.Context, tenantID string) ([]*Project, error)
}
