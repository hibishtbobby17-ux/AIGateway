package oidc

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var (
	ErrProviderNotFound = errors.New("external identity provider not found or inactive")
	ErrUnmappedClaim    = errors.New("external claim could not be mapped to internal platform role")
)

// ProviderConfig represents configuration for an external OIDC IdP (Okta, Auth0, Entra ID).
type ProviderConfig struct {
	ID           string            `json:"id"`
	TenantID     string            `json:"tenant_id"`
	Name         string            `json:"name"`       // "okta", "auth0", "entra-id"
	IssuerURL    string            `json:"issuer_url"` // e.g. "https://dev-123.okta.com"
	ClientID     string            `json:"client_id"`
	ClientSecret string            `json:"-"`
	ClaimMapping map[string]string `json:"claim_mapping"` // e.g. {"okta_group_dev": "tool-consumer"}
	Active       bool              `json:"active"`
}

// FederationManager manages external federated identity providers and claim translation.
type FederationManager struct {
	mu        sync.RWMutex
	providers map[string]*ProviderConfig // key: tenantID + ":" + providerID
}

// NewFederationManager creates a new federation manager.
func NewFederationManager() *FederationManager {
	return &FederationManager{
		providers: make(map[string]*ProviderConfig),
	}
}

// RegisterProvider configures an external IdP for a tenant.
func (fm *FederationManager) RegisterProvider(p *ProviderConfig) {
	fm.mu.Lock()
	defer fm.mu.Unlock()
	key := p.TenantID + ":" + p.ID
	fm.providers[key] = p
}

// GetProvider retrieves an active external provider.
func (fm *FederationManager) GetProvider(tenantID, providerID string) (*ProviderConfig, error) {
	fm.mu.RLock()
	defer fm.mu.RUnlock()
	key := tenantID + ":" + providerID
	p, ok := fm.providers[key]
	if !ok || !p.Active {
		return nil, ErrProviderNotFound
	}
	return p, nil
}

// MapExternalClaims translates claims from an external IdP token into platform roles.
func (fm *FederationManager) MapExternalClaims(ctx context.Context, tenantID, providerID string, rawClaims map[string]any) ([]string, error) {
	provider, err := fm.GetProvider(tenantID, providerID)
	if err != nil {
		return nil, err
	}

	var mappedRoles []string

	// Check mapped groups or roles in external claim
	for claimKey, targetRole := range provider.ClaimMapping {
		if val, ok := rawClaims[claimKey]; ok {
			switch v := val.(type) {
			case string:
				if v != "" {
					mappedRoles = append(mappedRoles, targetRole)
				}
			case []string:
				if len(v) > 0 {
					mappedRoles = append(mappedRoles, targetRole)
				}
			case []any:
				if len(v) > 0 {
					mappedRoles = append(mappedRoles, targetRole)
				}
			}
		}
	}

	if len(mappedRoles) == 0 {
		// Assign default fallback role if permitted, or return notice
		mappedRoles = append(mappedRoles, "tool-consumer")
	}

	return deduplicate(mappedRoles), nil
}

func deduplicate(list []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, item := range list {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out
}
