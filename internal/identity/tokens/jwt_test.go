package tokens

import (
	"errors"
	"strings"
	"testing"
	"time"

	"project_alpha/internal/identity/keys"
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
	verifier := NewVerifier(km, nil, "https://expected-issuer.com", "https://expected-aud.com")

	// Wrong issuer
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
}
