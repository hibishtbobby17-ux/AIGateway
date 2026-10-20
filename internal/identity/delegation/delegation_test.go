package delegation_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/identity/tokens"
)

func TestTokenExchanger(t *testing.T) {
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}

	exchanger, err := delegation.NewTokenExchanger(keyManager, "https://gateway.example.com", 5*time.Minute)
	if err != nil {
		t.Fatalf("failed creating exchanger: %v", err)
	}

	caller := principal.Principal{
		Subject:  "user-42",
		TenantID: "tenant-omega",
		Roles:    []string{"tool-consumer"},
		Scopes:   []string{"tools:call"},
	}

	ctx := principal.WithContext(context.Background(), caller)

	tokenStr, err := exchanger.Exchange(ctx, caller, "upstream-github-server", []string{"repo:read"})
	if err != nil {
		t.Fatalf("token exchange failed: %v", err)
	}

	// Verify token with platform verifier targeting the upstream server audience
	revocationStore := tokens.NewRevocationManager()
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://gateway.example.com", "upstream-github-server")

	claims, err := verifier.VerifyContext(ctx, tokenStr)
	if err != nil {
		t.Fatalf("verification of exchanged token failed: %v", err)
	}

	if claims.Subject != "user-42" {
		t.Errorf("expected subject user-42, got %s", claims.Subject)
	}
	if claims.TenantID != "tenant-omega" {
		t.Errorf("expected tenant-omega, got %s", claims.TenantID)
	}
	if claims.Audience != "upstream-github-server" {
		t.Errorf("expected audience upstream-github-server, got %s", claims.Audience)
	}
	if act, ok := claims.Attributes["act"].(map[string]any); !ok || act["sub"] != "ai-gateway" {
		t.Errorf("expected RFC 8693 actor claim sub=ai-gateway, got %v", claims.Attributes["act"])
	}

	// Fail on missing audience
	if _, err := exchanger.Exchange(ctx, caller, "", nil); err == nil {
		t.Errorf("expected error on empty audience, got nil")
	}

	// Fail on empty principal
	if _, err := exchanger.Exchange(ctx, principal.Principal{}, "srv", nil); err == nil {
		t.Errorf("expected error on empty principal, got nil")
	}
}

func TestProviderResolution(t *testing.T) {
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}
	exchanger, _ := delegation.NewTokenExchanger(keyManager, "https://gateway.example.com", 5*time.Minute)
	provider := delegation.NewProvider(exchanger)

	ctx := principal.WithContext(context.Background(), principal.Principal{
		Subject:  "agent-alice",
		TenantID: "tenant-1",
		Roles:    []string{"agent-operator"},
	})

	// 1. None
	cNone, err := provider.Resolve(ctx, "srv-1", delegation.UpstreamAuthConfig{Type: delegation.TypeNone})
	if err != nil || cNone.Type() != delegation.TypeNone {
		t.Fatalf("unexpected result for None: %v, %v", cNone, err)
	}

	// 2. Static Bearer
	cBearer, err := provider.Resolve(ctx, "srv-1", delegation.UpstreamAuthConfig{
		Type:        delegation.TypeStaticBearer,
		StaticToken: "secret-token-123",
	})
	if err != nil || cBearer.Type() != delegation.TypeStaticBearer {
		t.Fatalf("unexpected result for StaticBearer: %v, %v", cBearer, err)
	}
	req, _ := http.NewRequest(http.MethodGet, "http://upstream", nil)
	cBearer.Apply(req)
	if req.Header.Get("Authorization") != "Bearer secret-token-123" {
		t.Errorf("wrong header: %s", req.Header.Get("Authorization"))
	}

	// 3. Basic
	cBasic, err := provider.Resolve(ctx, "srv-1", delegation.UpstreamAuthConfig{
		Type:     delegation.TypeBasic,
		Username: "admin",
		Password: "password",
	})
	if err != nil || cBasic.Type() != delegation.TypeBasic {
		t.Fatalf("unexpected result for Basic: %v, %v", cBasic, err)
	}

	// 4. API Key
	cAPIKey, err := provider.Resolve(ctx, "srv-1", delegation.UpstreamAuthConfig{
		Type:         delegation.TypeAPIKey,
		APIKey:       "key-xyz",
		APIKeyHeader: "X-Custom-Key",
	})
	if err != nil || cAPIKey.Type() != delegation.TypeAPIKey {
		t.Fatalf("unexpected result for APIKey: %v, %v", cAPIKey, err)
	}
	reqAPI, _ := http.NewRequest(http.MethodGet, "http://upstream", nil)
	cAPIKey.Apply(reqAPI)
	if reqAPI.Header.Get("X-Custom-Key") != "key-xyz" {
		t.Errorf("wrong header: %s", reqAPI.Header.Get("X-Custom-Key"))
	}

	// 5. Delegated Token Exchange
	cDelegated, err := provider.Resolve(ctx, "srv-remote", delegation.UpstreamAuthConfig{
		Type: delegation.TypeDelegatedTokenExchange,
	})
	if err != nil || cDelegated.Type() != delegation.TypeDelegatedTokenExchange {
		t.Fatalf("unexpected result for Delegated: %v, %v", cDelegated, err)
	}

	// 6. Fail closed when principal is missing for delegation
	_, err = provider.Resolve(context.Background(), "srv-remote", delegation.UpstreamAuthConfig{
		Type: delegation.TypeDelegatedTokenExchange,
	})
	if err == nil {
		t.Fatalf("expected error when resolving delegated token without principal, got nil")
	}
}

func TestAntiRelayProtection(t *testing.T) {
	inboundToken := "raw-inbound-client-token-abc"

	// Relayed token must be rejected
	relayedCred := delegation.BearerCredential{Token: inboundToken}
	if err := delegation.ValidateAntiRelay(inboundToken, relayedCred); err == nil {
		t.Errorf("expected anti-relay error when forwarding raw token, got nil")
	}

	// Different/exchanged token must pass
	exchangedCred := delegation.BearerCredential{Token: "new-downstream-token-xyz", IsDelegated: true}
	if err := delegation.ValidateAntiRelay(inboundToken, exchangedCred); err != nil {
		t.Errorf("expected success for distinct exchanged token, got: %v", err)
	}
}
