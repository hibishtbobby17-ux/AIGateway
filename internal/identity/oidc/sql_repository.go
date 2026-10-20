package oidc

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

var (
	ErrInvalidProviderConfig = errors.New("invalid oidc provider configuration")
)

// SQLProviderRepository persists tenant-scoped OIDC provider configurations in SQL.
type SQLProviderRepository struct {
	db *sql.DB
}

// NewSQLProviderRepository creates a new OIDC provider repository.
func NewSQLProviderRepository(db *sql.DB) (*SQLProviderRepository, error) {
	if db == nil {
		return nil, errors.New("database handle cannot be nil")
	}
	return &SQLProviderRepository{db: db}, nil
}

// SaveProvider inserts or updates an external provider registration for a tenant.
func (r *SQLProviderRepository) SaveProvider(ctx context.Context, p *ProviderConfig) error {
	if p == nil {
		return ErrInvalidProviderConfig
	}
	if p.ID == "" || p.TenantID == "" || p.IssuerURL == "" || p.ClientID == "" {
		return fmt.Errorf("%w: id, tenant_id, issuer_url, and client_id are required", ErrInvalidProviderConfig)
	}

	claimMappingJSON, err := json.Marshal(p.ClaimMapping)
	if err != nil {
		return fmt.Errorf("encode claim mapping: %w", err)
	}

	query := `
	INSERT INTO oidc_providers (id, tenant_id, name, issuer_url, client_id, claim_mapping, active, updated_at)
	VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
	ON CONFLICT (tenant_id, id)
	DO UPDATE SET name = excluded.name,
	              issuer_url = excluded.issuer_url,
	              client_id = excluded.client_id,
	              claim_mapping = excluded.claim_mapping,
	              active = excluded.active,
	              updated_at = CURRENT_TIMESTAMP`

	_, err = r.db.ExecContext(ctx, query,
		p.ID, p.TenantID, p.Name, p.IssuerURL, p.ClientID, string(claimMappingJSON), p.Active,
	)
	if err != nil {
		return fmt.Errorf("save oidc provider: %w", err)
	}
	return nil
}

// GetProvider retrieves a specific provider for a tenant.
func (r *SQLProviderRepository) GetProvider(ctx context.Context, tenantID, providerID string) (*ProviderConfig, error) {
	if tenantID == "" || providerID == "" {
		return nil, errors.New("tenant_id and provider_id are required")
	}

	query := `
	SELECT id, tenant_id, name, issuer_url, client_id, claim_mapping, active
	FROM oidc_providers
	WHERE tenant_id = $1 AND id = $2`

	var p ProviderConfig
	var mappingStr string
	err := r.db.QueryRowContext(ctx, query, tenantID, providerID).Scan(
		&p.ID, &p.TenantID, &p.Name, &p.IssuerURL, &p.ClientID, &mappingStr, &p.Active,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrProviderNotFound
		}
		return nil, fmt.Errorf("get oidc provider: %w", err)
	}

	if mappingStr != "" {
		_ = json.Unmarshal([]byte(mappingStr), &p.ClaimMapping)
	}
	return &p, nil
}

// ListProviders retrieves all external providers configured for a tenant.
func (r *SQLProviderRepository) ListProviders(ctx context.Context, tenantID string) ([]*ProviderConfig, error) {
	if tenantID == "" {
		return nil, errors.New("tenant_id is required")
	}

	query := `
	SELECT id, tenant_id, name, issuer_url, client_id, claim_mapping, active
	FROM oidc_providers
	WHERE tenant_id = $1
	ORDER BY id`

	rows, err := r.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list oidc providers: %w", err)
	}
	defer rows.Close()

	var providers []*ProviderConfig
	for rows.Next() {
		var p ProviderConfig
		var mappingStr string
		if err := rows.Scan(&p.ID, &p.TenantID, &p.Name, &p.IssuerURL, &p.ClientID, &mappingStr, &p.Active); err != nil {
			return nil, fmt.Errorf("scan oidc provider: %w", err)
		}
		if mappingStr != "" {
			_ = json.Unmarshal([]byte(mappingStr), &p.ClaimMapping)
		}
		providers = append(providers, &p)
	}
	return providers, rows.Err()
}

// DeleteProvider deletes an external provider registration.
func (r *SQLProviderRepository) DeleteProvider(ctx context.Context, tenantID, providerID string) error {
	if tenantID == "" || providerID == "" {
		return errors.New("tenant_id and provider_id are required")
	}

	_, err := r.db.ExecContext(ctx, "DELETE FROM oidc_providers WHERE tenant_id = $1 AND id = $2", tenantID, providerID)
	if err != nil {
		return fmt.Errorf("delete oidc provider: %w", err)
	}
	return nil
}
