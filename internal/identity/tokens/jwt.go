package tokens

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"project_alpha/internal/identity/keys"
)

var (
	ErrTokenExpired       = errors.New("jwt token has expired")
	ErrInvalidSignature   = errors.New("invalid jwt cryptographic signature")
	ErrInvalidIssuer      = errors.New("jwt token issuer mismatch")
	ErrInvalidAudience    = errors.New("jwt token audience mismatch")
	ErrTokenRevoked       = errors.New("jwt token has been revoked")
	ErrMalformedToken     = errors.New("malformed jwt token structure")
	ErrUnsupportedKeyType = errors.New("unsupported jwt signing algorithm")
	ErrInvalidClaims      = errors.New("jwt token is missing required or valid claims")
	ErrTokenNotYetValid   = errors.New("jwt token is not yet valid")
	ErrRevocationCheck    = errors.New("jwt revocation status could not be checked")
	ErrRevocationStore    = errors.New("jwt revocation store is not configured")
	ErrVerifierConfig     = errors.New("jwt verifier requires configured issuer and audience")
)

// Header represents a standard JWT header.
type Header struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid"`
}

// Claims represents claims embedded within platform JWTs.
type Claims struct {
	Issuer     string         `json:"iss"`
	Subject    string         `json:"sub"`
	Audience   string         `json:"aud"`
	TenantID   string         `json:"tenant_id"`
	Scopes     []string       `json:"scopes,omitempty"`
	Roles      []string       `json:"roles,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
	IssuedAt   int64          `json:"iat"`
	NotBefore  int64          `json:"nbf,omitempty"`
	ExpiresAt  int64          `json:"exp"`
	TokenID    string         `json:"jti"`
}

type RevocationChecker interface {
	CheckRevoked(context.Context, string) (bool, error)
}

func (c *Claims) UnmarshalJSON(data []byte) error {
	var wire struct {
		Issuer     string          `json:"iss"`
		Subject    string          `json:"sub"`
		Audience   json.RawMessage `json:"aud"`
		TenantID   string          `json:"tenant_id"`
		Scopes     []string        `json:"scopes"`
		ScopeList  []string        `json:"scp"`
		Scope      string          `json:"scope"`
		Roles      []string        `json:"roles"`
		Attributes map[string]any  `json:"attributes"`
		IssuedAt   int64           `json:"iat"`
		NotBefore  int64           `json:"nbf"`
		ExpiresAt  int64           `json:"exp"`
		TokenID    string          `json:"jti"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	var audience string
	if len(wire.Audience) > 0 && string(wire.Audience) != "null" {
		if err := json.Unmarshal(wire.Audience, &audience); err != nil {
			var audiences []string
			if listErr := json.Unmarshal(wire.Audience, &audiences); listErr != nil || len(audiences) != 1 {
				return fmt.Errorf("invalid JWT audience claim")
			}
			audience = audiences[0]
		}
	}
	scopes := wire.Scopes
	if len(scopes) == 0 {
		scopes = wire.ScopeList
	}
	if len(scopes) == 0 && wire.Scope != "" {
		scopes = strings.Fields(wire.Scope)
	}
	*c = Claims{
		Issuer:     wire.Issuer,
		Subject:    wire.Subject,
		Audience:   audience,
		TenantID:   wire.TenantID,
		Scopes:     scopes,
		Roles:      wire.Roles,
		Attributes: wire.Attributes,
		IssuedAt:   wire.IssuedAt,
		NotBefore:  wire.NotBefore,
		ExpiresAt:  wire.ExpiresAt,
		TokenID:    wire.TokenID,
	}
	return nil
}

// Sign creates an ES256-signed JWT token string.
func Sign(claims *Claims, key *keys.KeyPair) (string, error) {
	if claims == nil || key == nil {
		return "", fmt.Errorf("claims and key cannot be nil")
	}

	header := Header{
		Alg: "ES256",
		Typ: "JWT",
		Kid: key.ID,
	}

	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	headerEncoded := base64.RawURLEncoding.EncodeToString(headerJSON)
	claimsEncoded := base64.RawURLEncoding.EncodeToString(claimsJSON)

	signingInput := headerEncoded + "." + claimsEncoded
	hash := sha256.Sum256([]byte(signingInput))

	r, s, err := ecdsa.Sign(rand.Reader, key.Private, hash[:])
	if err != nil {
		return "", fmt.Errorf("failed creating ECDSA signature: %w", err)
	}

	// Format signature into standard IEEE P1363 (r || s, 64 bytes)
	sigBytes := make([]byte, 64)
	rBytes := r.Bytes()
	sBytes := s.Bytes()
	copy(sigBytes[32-len(rBytes):32], rBytes)
	copy(sigBytes[64-len(sBytes):64], sBytes)

	sigEncoded := base64.RawURLEncoding.EncodeToString(sigBytes)
	return signingInput + "." + sigEncoded, nil
}

// RevocationManager tracks revoked token IDs (JTIs).
type RevocationManager struct {
	mu      sync.RWMutex
	revoked map[string]time.Time
}

// NewRevocationManager creates a token revocation manager.
func NewRevocationManager() *RevocationManager {
	return &RevocationManager{
		revoked: make(map[string]time.Time),
	}
}

// Revoke adds a token JTI to the revocation blacklist.
func (rm *RevocationManager) Revoke(jti string, expiresAt time.Time) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.revoked[jti] = expiresAt
}

// IsRevoked checks if a JTI has been revoked.
func (rm *RevocationManager) IsRevoked(jti string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	exp, ok := rm.revoked[jti]
	if !ok {
		return false
	}
	if !exp.After(time.Now()) {
		delete(rm.revoked, jti)
		return false
	}
	return true
}

func (rm *RevocationManager) CheckRevoked(_ context.Context, jti string) (bool, error) {
	return rm.IsRevoked(jti), nil
}

// Verifier inspects and cryptographically validates JWT tokens.
type Verifier struct {
	keyManager       *keys.Manager
	revocation       RevocationChecker
	expectedIssuer   string
	expectedAudience string
}

// NewVerifier creates a new token verifier.
func NewVerifier(km *keys.Manager, rm RevocationChecker, expectedIssuer, expectedAudience string) *Verifier {
	return &Verifier{
		keyManager:       km,
		revocation:       rm,
		expectedIssuer:   expectedIssuer,
		expectedAudience: expectedAudience,
	}
}

// Verify decodes and cryptographically validates a JWT token.
func (v *Verifier) Verify(tokenString string) (*Claims, error) {
	return v.VerifyContext(context.Background(), tokenString)
}

func (v *Verifier) VerifyContext(ctx context.Context, tokenString string) (*Claims, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if v.expectedIssuer == "" || v.expectedAudience == "" {
		return nil, ErrVerifierConfig
	}
	if v.keyManager == nil {
		return nil, fmt.Errorf("%w: key manager is not configured", ErrInvalidSignature)
	}
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, ErrMalformedToken
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("%w: invalid header base64", ErrMalformedToken)
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: invalid payload base64", ErrMalformedToken)
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sigBytes) != 64 {
		return nil, fmt.Errorf("%w: invalid signature length", ErrInvalidSignature)
	}

	var header Header
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, fmt.Errorf("%w: invalid header JSON", ErrMalformedToken)
	}

	if header.Alg != "ES256" {
		return nil, fmt.Errorf("%w: %s (expected ES256)", ErrUnsupportedKeyType, header.Alg)
	}
	if header.Typ != "JWT" || header.Kid == "" {
		return nil, fmt.Errorf("%w: JWT typ and kid are required", ErrMalformedToken)
	}

	// Retrieve public key by kid
	keyPair, err := v.keyManager.GetKey(header.Kid)
	if err != nil {
		return nil, fmt.Errorf("%w: key id %q not recognized", ErrInvalidSignature, header.Kid)
	}

	// Verify cryptographic signature
	signingInput := parts[0] + "." + parts[1]
	hash := sha256.Sum256([]byte(signingInput))

	r := new(big.Int).SetBytes(sigBytes[:32])
	s := new(big.Int).SetBytes(sigBytes[32:])

	if !ecdsa.Verify(keyPair.Public, hash[:], r, s) {
		return nil, ErrInvalidSignature
	}

	// Parse claims
	var claims Claims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, fmt.Errorf("%w: invalid claims JSON", ErrMalformedToken)
	}

	now := time.Now().Unix()

	// Check expiration
	if claims.ExpiresAt == 0 || now >= claims.ExpiresAt {
		return nil, ErrTokenExpired
	}

	// Check issuer if configured
	if v.expectedIssuer != "" && claims.Issuer != v.expectedIssuer {
		return nil, fmt.Errorf("%w: token iss %q != expected %q", ErrInvalidIssuer, claims.Issuer, v.expectedIssuer)
	}

	// Check audience if configured
	if v.expectedAudience != "" && claims.Audience != v.expectedAudience {
		return nil, fmt.Errorf("%w: token aud %q != expected %q", ErrInvalidAudience, claims.Audience, v.expectedAudience)
	}

	if claims.Issuer == "" || claims.Audience == "" || claims.Subject == "" || claims.TenantID == "" ||
		claims.TokenID == "" || len(claims.Roles) == 0 || len(claims.Scopes) == 0 ||
		claims.IssuedAt == 0 || claims.IssuedAt > now || claims.ExpiresAt <= claims.IssuedAt {
		return nil, ErrInvalidClaims
	}
	if claims.NotBefore > 0 && now < claims.NotBefore {
		return nil, ErrTokenNotYetValid
	}
	if v.revocation == nil {
		return nil, ErrRevocationStore
	}
	revoked, err := v.revocation.CheckRevoked(ctx, claims.TokenID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrRevocationCheck, err)
	}
	if revoked {
		return nil, ErrTokenRevoked
	}
	return &claims, nil
}

func RevocationKey(tokenID string) string {
	sum := sha256.Sum256([]byte(tokenID))
	return hex.EncodeToString(sum[:])
}
