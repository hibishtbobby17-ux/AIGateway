package tokens

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"project_alpha/internal/config"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/storage"
	"project_alpha/migrations"
)

func TestJWTSignAndVerify(t *testing.T) {
	km, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}
	rm := NewRevocationManager()
	verifier := NewVerifier(km, rm, "https://gateway.local", "https://api.gateway.local")

	activeKey, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("failed getting active key: %v", err)
	}

	claims := &Claims{
		Issuer:    "https://gateway.local",
		Subject:   "client-123",
		Audience:  "https://api.gateway.local",
		TenantID:  "tenant-alpha",
		Scopes:    []string{"mcp:tools:call", "mcp:tools:discover"},
		Roles:     []string{"tool-consumer"},
		IssuedAt:  time.Now().Unix(),
		ExpiresAt: time.Now().Add(1 * time.Hour).Unix(),
		TokenID:   "token-uuid-1",
	}

	tokenStr, err := Sign(claims, activeKey)
	if err != nil {
		t.Fatalf("failed signing token: %v", err)
	}

	// Verify valid token
	parsed, err := verifier.Verify(tokenStr)
	if err != nil {
		t.Fatalf("expected valid token verification, got error: %v", err)
	}
	if parsed.Subject != "client-123" || parsed.TenantID != "tenant-alpha" {
		t.Errorf("unexpected claims values: %+v", parsed)
	}

	// Verify Expired Token Rejection
	expiredClaims := &Claims{
		Issuer:    "https://gateway.local",
		Subject:   "client-123",
		Audience:  "https://api.gateway.local",
		TenantID:  "tenant-alpha",
		IssuedAt:  time.Now().Add(-2 * time.Hour).Unix(),
		ExpiresAt: time.Now().Add(-1 * time.Hour).Unix(),
		TokenID:   "token-expired",
	}
	expiredStr, _ := Sign(expiredClaims, activeKey)
	_, err = verifier.Verify(expiredStr)
	if !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expected ErrTokenExpired, got: %v", err)
	}

	// Verify Signature Tampering Rejection
	parts := strings.Split(tokenStr, ".")
	tamperedPayload := parts[1] + "tamper"
	tamperedToken := parts[0] + "." + tamperedPayload + "." + parts[2]
	_, err = verifier.Verify(tamperedToken)
	if err == nil {
		t.Fatalf("expected signature or decoding error for tampered token, got nil")
	}

	// Verify Token Revocation
	rm.Revoke("token-uuid-1", time.Now().Add(1*time.Hour))
	_, err = verifier.Verify(tokenStr)
	if !errors.Is(err, ErrTokenRevoked) {
		t.Fatalf("expected ErrTokenRevoked after revocation, got: %v", err)
	}
}

func TestJWTIssuerAndAudienceValidation(t *testing.T) {
	km, _ := keys.NewManager()
	activeKey, _ := km.GetActiveKey()
	verifier := NewVerifier(km, NewRevocationManager(), "https://expected-issuer.com", "https://expected-aud.com")

	c1 := &Claims{
		Issuer:    "https://wrong-issuer.com",
		Audience:  "https://expected-aud.com",
		ExpiresAt: time.Now().Add(1 * time.Hour).Unix(),
	}
	t1, _ := Sign(c1, activeKey)
	_, err := verifier.Verify(t1)
	if !errors.Is(err, ErrInvalidIssuer) {
		t.Errorf("expected ErrInvalidIssuer, got: %v", err)
	}

	// Wrong audience
	c2 := &Claims{
		Issuer:    "https://expected-issuer.com",
		Audience:  "https://wrong-aud.com",
		ExpiresAt: time.Now().Add(1 * time.Hour).Unix(),
	}
	t2, _ := Sign(c2, activeKey)
	_, err = verifier.Verify(t2)
	if !errors.Is(err, ErrInvalidAudience) {
		t.Errorf("expected ErrInvalidAudience, got: %v", err)
	}

	// A configured audience must also reject tokens that omit the aud claim.
	c3 := &Claims{
		Issuer:    "https://expected-issuer.com",
		ExpiresAt: time.Now().Add(1 * time.Hour).Unix(),
	}
	t3, _ := Sign(c3, activeKey)
	_, err = verifier.Verify(t3)
	if !errors.Is(err, ErrInvalidAudience) {
		t.Errorf("expected ErrInvalidAudience for missing aud, got: %v", err)
	}
}

func TestJWTVerifierRejectsMissingRequiredClaimsAndFutureTimes(t *testing.T) {
	km, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}
	active, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("get active key: %v", err)
	}
	now := time.Now()
	valid := Claims{
		Issuer: "https://issuer.example", Subject: "user-1", Audience: "gateway-api",
		TenantID: "tenant-1", Scopes: []string{"mcp:read"}, Roles: []string{"user"},
		IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Hour).Unix(), TokenID: "token-1",
	}
	tests := []struct {
		name   string
		change func(*Claims)
		want   error
	}{
		{name: "missing subject", change: func(c *Claims) { c.Subject = "" }, want: ErrInvalidClaims},
		{name: "missing tenant", change: func(c *Claims) { c.TenantID = "" }, want: ErrInvalidClaims},
		{name: "missing token id", change: func(c *Claims) { c.TokenID = "" }, want: ErrInvalidClaims},
		{name: "missing roles", change: func(c *Claims) { c.Roles = nil }, want: ErrInvalidClaims},
		{name: "missing scopes", change: func(c *Claims) { c.Scopes = nil }, want: ErrInvalidClaims},
		{name: "future issued at", change: func(c *Claims) { c.IssuedAt = now.Add(time.Minute).Unix() }, want: ErrInvalidClaims},
		{name: "not yet valid", change: func(c *Claims) { c.NotBefore = now.Add(time.Minute).Unix() }, want: ErrTokenNotYetValid},
	}
	verifier := NewVerifier(km, NewRevocationManager(), valid.Issuer, valid.Audience)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			claims := valid
			test.change(&claims)
			token, err := Sign(&claims, active)
			if err != nil {
				t.Fatalf("sign token: %v", err)
			}
			if _, err := verifier.Verify(token); !errors.Is(err, test.want) {
				t.Fatalf("Verify() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestSQLRevocationStorePersistsAcrossInstances(t *testing.T) {
	ctx := context.Background()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()
	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	first, err := NewSQLRevocationStore(db)
	if err != nil {
		t.Fatalf("create SQL revocation store: %v", err)
	}
	expiry := time.Now().Add(time.Hour)
	if err := first.Revoke(ctx, "sensitive-token-id", expiry); err != nil {
		t.Fatalf("persist revocation: %v", err)
	}
	second, err := NewSQLRevocationStore(db)
	if err != nil {
		t.Fatalf("create second SQL revocation store: %v", err)
	}
	revoked, err := second.CheckRevoked(ctx, "sensitive-token-id")
	if err != nil || !revoked {
		t.Fatalf("persisted revocation = (%t, %v), want true and no error", revoked, err)
	}
	revoked, err = second.CheckRevoked(ctx, "another-token-id")
	if err != nil || revoked {
		t.Fatalf("unknown revocation = (%t, %v), want false and no error", revoked, err)
	}
	if err := first.Revoke(ctx, "sensitive-token-id", time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("ignore already expired revocation: %v", err)
	}
	revoked, err = second.CheckRevoked(ctx, "sensitive-token-id")
	if err != nil || !revoked {
		t.Fatalf("expired re-revocation erased active record = (%t, %v)", revoked, err)
	}
}

func TestVerifierFailsClosedWhenRevocationStoreFails(t *testing.T) {
	km, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}

	active, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("get active key: %v", err)
	}
	now := time.Now()
	token, err := Sign(&Claims{
		Issuer: "https://issuer.example", Subject: "user-1", Audience: "gateway-api",
		TenantID: "tenant-1", Scopes: []string{"mcp:read"}, Roles: []string{"user"},
		IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Hour).Unix(), TokenID: "token-1",
	}, active)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()
	store, err := NewSQLRevocationStore(db)
	if err != nil {
		t.Fatalf("create SQL revocation store: %v", err)
	}
	verifier := NewVerifier(km, store, "https://issuer.example", "gateway-api")
	if _, err := verifier.Verify(token); !errors.Is(err, ErrRevocationCheck) {
		t.Fatalf("Verify() error = %v, want ErrRevocationCheck when storage is unavailable", err)
	}
}

func TestVerifierRequiresRevocationStore(t *testing.T) {
	km, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}

	active, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("get active key: %v", err)
	}
	now := time.Now()
	token, err := Sign(&Claims{
		Issuer: "https://issuer.example", Subject: "user-1", Audience: "gateway-api",
		TenantID: "tenant-1", Scopes: []string{"mcp:read"}, Roles: []string{"user"},
		IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Hour).Unix(), TokenID: "token-1",
	}, active)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	if _, err := NewVerifier(km, nil, "https://issuer.example", "gateway-api").Verify(token); !errors.Is(err, ErrRevocationStore) {
		t.Fatalf("Verify() error = %v, want ErrRevocationStore", err)
	}
}

func TestVerifierRequiresIssuerAndAudienceConfiguration(t *testing.T) {
	km, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}
	active, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("get active key: %v", err)
	}
	now := time.Now()
	token, err := Sign(&Claims{
		Issuer: "https://issuer.example", Subject: "user-1", Audience: "gateway-api",
		TenantID: "tenant-1", Scopes: []string{"mcp:read"}, Roles: []string{"user"},
		IssuedAt: now.Unix(), ExpiresAt: now.Add(time.Hour).Unix(), TokenID: "token-1",
	}, active)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	verifier := NewVerifier(km, NewRevocationManager(), "", "gateway-api")
	if _, err := verifier.Verify(token); !errors.Is(err, ErrVerifierConfig) {
		t.Fatalf("Verify() error = %v, want ErrVerifierConfig", err)
	}
}
