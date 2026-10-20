package oidc_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"project_alpha/internal/config"
	"project_alpha/internal/identity/oidc"
	"project_alpha/internal/storage"
	"project_alpha/migrations"
)

func TestOIDCDiscovery(t *testing.T) {
	ctx := context.Background()

	// 1. Mock OIDC Identity Provider Discovery Endpoint
	var mockIssuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		configDoc := oidc.OpenIDConfiguration{
			Issuer:                mockIssuer,
			AuthorizationEndpoint: mockIssuer + "/oauth2/v1/authorize",
			TokenEndpoint:         mockIssuer + "/oauth2/v1/token",
			JWKSURI:               mockIssuer + "/oauth2/v1/keys",
			UserinfoEndpoint:      mockIssuer + "/oauth2/v1/userinfo",
		}
		_ = json.NewEncoder(w).Encode(configDoc)
	}))
	defer server.Close()
	mockIssuer = server.URL

	discoverer := oidc.NewDiscoverer(true, 5*time.Second)

	// Valid discovery
	doc, err := discoverer.Discover(ctx, mockIssuer)
	if err != nil {
		t.Fatalf("expected successful discovery, got: %v", err)
	}
	if doc.Issuer != mockIssuer {
		t.Errorf("expected issuer %s, got %s", mockIssuer, doc.Issuer)
	}
	if doc.JWKSURI != mockIssuer+"/oauth2/v1/keys" {
		t.Errorf("expected JWKSURI %s, got %s", mockIssuer+"/oauth2/v1/keys", doc.JWKSURI)
	}

	// Issuer mismatch test
	mismatchServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oidc.OpenIDConfiguration{
			Issuer:                "https://imposter-idp.example.com",
			AuthorizationEndpoint: "https://imposter-idp.example.com/auth",
			TokenEndpoint:         "https://imposter-idp.example.com/token",
			JWKSURI:               "https://imposter-idp.example.com/jwks",
		})
	}))
	defer mismatchServer.Close()

	_, err = discoverer.Discover(ctx, mismatchServer.URL)
	if !errors.Is(err, oidc.ErrIssuerMismatch) {
		t.Errorf("expected ErrIssuerMismatch, got: %v", err)
	}

	// Missing endpoints test
	var incompleteURL string
	incompleteServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oidc.OpenIDConfiguration{
			Issuer: incompleteURL, // missing JWKSURI, TokenEndpoint, etc.
		})
	}))
	defer incompleteServer.Close()
	incompleteURL = incompleteServer.URL

	_, err = discoverer.Discover(ctx, incompleteURL)
	if !errors.Is(err, oidc.ErrMissingEndpoints) {
		t.Errorf("expected ErrMissingEndpoints for incomplete discovery doc, got: %v", err)
	}
}

func TestSQLProviderRepository_TenantIsolation(t *testing.T) {
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening test db: %v", err)
	}
	defer db.Close()

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	// Insert parent tenants
	_, err = db.ExecContext(ctx, "INSERT INTO tenants (id, name, slug) VALUES ('t1', 'Tenant 1', 't1'), ('t2', 'Tenant 2', 't2')")
	if err != nil {
		t.Fatalf("failed inserting tenants: %v", err)
	}

	repo, err := oidc.NewSQLProviderRepository(db)
	if err != nil {
		t.Fatalf("failed creating repo: %v", err)
	}

	p1 := &oidc.ProviderConfig{
		ID:        "okta-dev",
		TenantID:  "t1",
		Name:      "okta",
		IssuerURL: "https://dev-123.okta.com",
		ClientID:  "client-abc",
		ClaimMapping: map[string]string{
			"okta_admin": "tenant-admin",
			"okta_user":  "tool-consumer",
		},
		Active: true,
	}

	if err := repo.SaveProvider(ctx, p1); err != nil {
		t.Fatalf("failed saving provider: %v", err)
	}

	// Retrieve for t1
	fetched, err := repo.GetProvider(ctx, "t1", "okta-dev")
	if err != nil {
		t.Fatalf("failed getting provider for t1: %v", err)
	}
	if fetched.IssuerURL != "https://dev-123.okta.com" || fetched.ClaimMapping["okta_admin"] != "tenant-admin" {
		t.Errorf("unexpected fetched provider: %+v", fetched)
	}

	// Attempt cross-tenant lookup with t2 -> must return ErrProviderNotFound
	_, err = repo.GetProvider(ctx, "t2", "okta-dev")
	if !errors.Is(err, oidc.ErrProviderNotFound) {
		t.Errorf("expected ErrProviderNotFound for cross-tenant access, got: %v", err)
	}

	// List providers for t1 vs t2
	listT1, err := repo.ListProviders(ctx, "t1")
	if err != nil || len(listT1) != 1 {
		t.Fatalf("expected 1 provider for t1, got %d", len(listT1))
	}
	listT2, err := repo.ListProviders(ctx, "t2")
	if err != nil || len(listT2) != 0 {
		t.Fatalf("expected 0 providers for t2, got %d", len(listT2))
	}

	// Delete provider
	if err := repo.DeleteProvider(ctx, "t1", "okta-dev"); err != nil {
		t.Fatalf("failed deleting provider: %v", err)
	}
	_, err = repo.GetProvider(ctx, "t1", "okta-dev")
	if !errors.Is(err, oidc.ErrProviderNotFound) {
		t.Errorf("expected ErrProviderNotFound after deletion, got: %v", err)
	}
}

func TestFederationManager_ClaimMapping(t *testing.T) {
	fm := oidc.NewFederationManager()
	fm.RegisterProvider(&oidc.ProviderConfig{
		ID:        "auth0",
		TenantID:  "tenant-alpha",
		Name:      "auth0",
		IssuerURL: "https://auth0.example.com",
		ClientID:  "client-1",
		ClaimMapping: map[string]string{
			"groups": "tenant-admin",
			"tier":   "agent-operator",
		},
		Active: true,
	})

	// 1. Single matching claim
	roles, err := fm.MapExternalClaims(context.Background(), "tenant-alpha", "auth0", map[string]any{
		"groups": []string{"admins"},
	})
	if err != nil {
		t.Fatalf("failed mapping claims: %v", err)
	}
	if len(roles) != 1 || roles[0] != "tenant-admin" {
		t.Errorf("expected [tenant-admin], got: %v", roles)
	}

	// 2. Fallback default role if no mapped claims match
	fallbackRoles, err := fm.MapExternalClaims(context.Background(), "tenant-alpha", "auth0", map[string]any{
		"unknown_claim": "value",
	})
	if err != nil {
		t.Fatalf("failed mapping fallback: %v", err)
	}
	if len(fallbackRoles) != 1 || fallbackRoles[0] != "tool-consumer" {
		t.Errorf("expected default fallback [tool-consumer], got: %v", fallbackRoles)
	}
}
