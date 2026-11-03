package oauth

import (
	"context"
	"errors"
	"net/http/httptest"
	"reflect"
	"testing"

	"AIGateway/internal/identity/principal"
)

func TestSQLAuthorizationServiceRequiresIdentityTenantAndConsent(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	client := &Client{
		ID:                "record-consent",
		ClientID:          "consent-app",
		ClientType:        "PUBLIC",
		TenantID:          "tenant-1",
		RedirectURIs:      []string{"https://app.example/callback"},
		AllowedGrantTypes: []string{"authorization_code"},
		AllowedScopes:     []string{"mcp:read", "mcp:write"},
	}
	if err := store.RegisterClient(context.Background(), client); err != nil {
		t.Fatalf("register client: %v", err)
	}
	service, err := NewSQLAuthorizationService(store.db)
	if err != nil {
		t.Fatalf("create authorization service: %v", err)
	}
	request := httptest.NewRequest("GET", "/oauth/authorize", nil)

	if _, err := service.Authorize(context.Background(), request, client, []string{"mcp:read"}); !errors.Is(err, ErrAuthenticatedPrincipalRequired) {
		t.Fatalf("missing principal error = %v, want ErrAuthenticatedPrincipalRequired", err)
	}
	wrongTenant := principal.WithContext(context.Background(), principal.Principal{
		Subject: "user-1", TenantID: "tenant-2",
	})
	if _, err := service.Authorize(wrongTenant, request, client, []string{"mcp:read"}); !errors.Is(err, ErrConsentTenantMismatch) {
		t.Fatalf("wrong tenant error = %v, want ErrConsentTenantMismatch", err)
	}
	userContext := principal.WithContext(context.Background(), principal.Principal{
		Subject: "user-1", TenantID: "tenant-1",
	})
	if _, err := service.Authorize(userContext, request, client, []string{"mcp:read"}); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("missing consent error = %v, want ErrConsentRequired", err)
	}

	if err := service.GrantConsent(context.Background(), "tenant-1", "user-1", client.ClientID, []string{"mcp:read"}); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	decision, err := service.Authorize(userContext, request, client, []string{"mcp:read", "mcp:write"})
	if err != nil {
		t.Fatalf("authorize with consent: %v", err)
	}
	if decision.Subject != "user-1" || !reflect.DeepEqual(decision.Scopes, []string{"mcp:read"}) {
		t.Fatalf("authorization decision = %+v; want user-1 with only mcp:read", decision)
	}
	if _, err := service.Authorize(userContext, request, client, []string{"mcp:write"}); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("unconsented scope error = %v, want ErrConsentRequired", err)
	}

	if err := service.RevokeConsent(context.Background(), "tenant-1", "user-1", client.ClientID); err != nil {
		t.Fatalf("revoke consent: %v", err)
	}
	if _, err := service.Authorize(userContext, request, client, []string{"mcp:read"}); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("revoked consent error = %v, want ErrConsentRequired", err)
	}
}

func TestSQLAuthorizationServiceRejectsInvalidOrCrossTenantConsent(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	if err := store.RegisterClient(context.Background(), &Client{
		ID: "record-consent", ClientID: "consent-app", ClientType: "PUBLIC",
		TenantID: "tenant-1", RedirectURIs: []string{"https://app.example/callback"},
		AllowedGrantTypes: []string{"authorization_code"}, AllowedScopes: []string{"mcp:read"},
	}); err != nil {
		t.Fatalf("register client: %v", err)
	}
	service, err := NewSQLAuthorizationService(store.db)
	if err != nil {
		t.Fatalf("create authorization service: %v", err)
	}
	if err := service.GrantConsent(context.Background(), "tenant-2", "user-1", "consent-app", []string{"mcp:read"}); !errors.Is(err, ErrConsentTenantMismatch) {
		t.Fatalf("cross-tenant consent error = %v, want ErrConsentTenantMismatch", err)
	}
	if err := service.GrantConsent(context.Background(), "tenant-1", "user-1", "consent-app", []string{"mcp:admin"}); err == nil {
		t.Fatal("consent accepted a scope not assigned to the client")
	}
	if err := service.GrantConsent(context.Background(), "tenant-1", "user-1", "consent-app", []string{"mcp:read", "mcp:read"}); err == nil {
		t.Fatal("consent accepted duplicate scopes")
	}
}
