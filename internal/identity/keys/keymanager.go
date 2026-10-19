package keys

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// JWK represents a JSON Web Key for public key distribution.
type JWK struct {
	Kty string `json:"kty"`           // "EC"
	Crv string `json:"crv"`           // "P-256"
	X   string `json:"x"`             // Base64URL encoded X coordinate
	Y   string `json:"y"`             // Base64URL encoded Y coordinate
	Kid string `json:"kid"`           // Key ID
	Use string `json:"use"`           // "sig"
	Alg string `json:"alg"`           // "ES256"
}

// JWKS represents a standard JSON Web Key Set.
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// KeyPair represents an in-memory ECDSA P-256 key pair with metadata.
type KeyPair struct {
	ID        string
	Algorithm string // "ES256"
	Private   *ecdsa.PrivateKey
	Public    *ecdsa.PublicKey
	CreatedAt time.Time
	Active    bool
}

// Manager handles cryptographic signing keys, rotation, and JWKS publication.
type Manager struct {
	mu        sync.RWMutex
	keys      map[string]*KeyPair
	activeKey *KeyPair
}

// NewManager creates a key manager and initializes a new active ES256 key pair.
func NewManager() (*Manager, error) {
	m := &Manager{
		keys: make(map[string]*KeyPair),
	}

	if err := m.RotateKey(); err != nil {
		return nil, fmt.Errorf("failed initializing signing key: %w", err)
	}

	return m, nil
}

// RotateKey generates a new active key pair and marks existing keys as non-active (for verification only).
func (m *Manager) RotateKey() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed generating ECDSA P-256 key: %w", err)
	}

	// Generate deterministic key ID from public key hash
	pubBytes := append(priv.PublicKey.X.Bytes(), priv.PublicKey.Y.Bytes()...)
	hash := sha256.Sum256(pubBytes)
	kid := hex.EncodeToString(hash[:8])

	kp := &KeyPair{
		ID:        kid,
		Algorithm: "ES256",
		Private:   priv,
		Public:    &priv.PublicKey,
		CreatedAt: time.Now().UTC(),
		Active:    true,
	}

	if m.activeKey != nil {
		m.activeKey.Active = false
	}

	m.activeKey = kp
	m.keys[kid] = kp

	return nil
}

// GetActiveKey returns the current key pair for signing new tokens.
func (m *Manager) GetActiveKey() (*KeyPair, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.activeKey == nil {
		return nil, fmt.Errorf("no active signing key available")
	}
	return m.activeKey, nil
}

// GetKey returns a key pair by Key ID (used for token signature verification).
func (m *Manager) GetKey(kid string) (*KeyPair, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	kp, ok := m.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key id %q not found", kid)
	}
	return kp, nil
}

// GetJWKS exports all public keys in standard JWKS format.
func (m *Manager) GetJWKS() JWKS {
	m.mu.RLock()
	defer m.mu.RUnlock()

	jwks := JWKS{Keys: make([]JWK, 0, len(m.keys))}
	for _, kp := range m.keys {
		jwk := JWK{
			Kty: "EC",
			Crv: "P-256",
			Kid: kp.ID,
			Use: "sig",
			Alg: kp.Algorithm,
			X:   encodeBase64URL(kp.Public.X.Bytes()),
			Y:   encodeBase64URL(kp.Public.Y.Bytes()),
		}
		jwks.Keys = append(jwks.Keys, jwk)
	}

	return jwks
}

func encodeBase64URL(data []byte) string {
	// Pad to 32 bytes for P-256 coordinate standard
	padded := make([]byte, 32)
	copy(padded[32-len(data):], data)
	return base64.RawURLEncoding.EncodeToString(padded)
}

// Base64URLDecode decodes a base64url string.
func Base64URLDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// BigIntFromBase64URL converts a base64url coordinate to a big.Int.
func BigIntFromBase64URL(s string) (*big.Int, error) {
	b, err := Base64URLDecode(s)
	if err != nil {
		return nil, err
	}
	return new(big.Int).SetBytes(b), nil
}
