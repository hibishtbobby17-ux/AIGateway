package keys

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
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
	Kty string `json:"kty"` // "EC"
	Crv string `json:"crv"` // "P-256"
	X   string `json:"x"`   // Base64URL encoded X coordinate
	Y   string `json:"y"`   // Base64URL encoded Y coordinate
	Kid string `json:"kid"` // Key ID
	Use string `json:"use"` // "sig"
	Alg string `json:"alg"` // "ES256"
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

type StoredKey struct {
	ID                  string
	Algorithm           string
	EncryptedPrivateKey string
	CreatedAt           time.Time
	Active              bool
}

type Repository interface {
	LoadKeys(context.Context) ([]StoredKey, error)
	ActivateKey(context.Context, StoredKey) error
}

// Manager handles cryptographic signing keys, rotation, and JWKS publication.
type Manager struct {
	mu            sync.RWMutex
	keys          map[string]*KeyPair
	activeKey     *KeyPair
	repository    Repository
	encryptionKey []byte
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

// NewPersistentManager loads shared keys from a repository and encrypts new
// private keys at rest with the supplied 256-bit AES key.
func NewPersistentManager(ctx context.Context, repository Repository, encryptionKey []byte) (*Manager, error) {
	if repository == nil {
		return nil, fmt.Errorf("signing key repository is required")
	}
	if len(encryptionKey) != 32 {
		return nil, fmt.Errorf("signing key encryption key must be exactly 32 bytes")
	}
	m := &Manager{
		keys:          make(map[string]*KeyPair),
		repository:    repository,
		encryptionKey: append([]byte(nil), encryptionKey...),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.refreshLocked(ctx); err != nil {
		return nil, fmt.Errorf("load persisted signing keys: %w", err)
	}
	if m.activeKey == nil {
		if err := m.rotateLocked(ctx); err != nil {
			return nil, fmt.Errorf("initialize persisted signing key: %w", err)
		}
	}
	return m, nil
}

// RotateKey generates a new active key pair and marks existing keys as non-active (for verification only).
func (m *Manager) RotateKey() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	return m.rotateLocked(context.Background())
}

func (m *Manager) RotateKeyContext(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rotateLocked(ctx)
}

func (m *Manager) rotateLocked(ctx context.Context) error {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed generating ECDSA P-256 key: %w", err)
	}

	kp := keyPairFromPrivate(priv, time.Now().UTC())
	if m.repository != nil {
		ciphertext, err := encryptPrivateKey(m.encryptionKey, priv)
		if err != nil {
			return fmt.Errorf("encrypt signing key: %w", err)
		}
		record := StoredKey{
			ID:                  kp.ID,
			Algorithm:           kp.Algorithm,
			EncryptedPrivateKey: ciphertext,
			CreatedAt:           kp.CreatedAt,
			Active:              true,
		}
		if err := m.repository.ActivateKey(ctx, record); err != nil {
			return fmt.Errorf("persist signing key rotation: %w", err)
		}
		return m.refreshLocked(ctx)
	}

	for _, key := range m.keys {
		key.Active = false
	}
	kp.Active = true
	m.activeKey = kp
	m.keys[kp.ID] = kp
	return nil
}

func (m *Manager) refreshLocked(ctx context.Context) error {
	if m.repository == nil {
		return nil
	}
	records, err := m.repository.LoadKeys(ctx)
	if err != nil {
		return err
	}
	keys := make(map[string]*KeyPair, len(records))
	var active *KeyPair
	for _, record := range records {
		priv, err := decryptPrivateKey(m.encryptionKey, record.EncryptedPrivateKey)
		if err != nil {
			return fmt.Errorf("decrypt signing key %q: %w", record.ID, err)
		}
		key := keyPairFromPrivate(priv, record.CreatedAt)
		if key.ID != record.ID || record.Algorithm != key.Algorithm {
			return fmt.Errorf("persisted signing key %q failed integrity validation", record.ID)
		}
		key.Active = record.Active
		if key.Active {
			if active != nil {
				return fmt.Errorf("multiple active signing keys are persisted")
			}
			active = key
		}
		keys[key.ID] = key
	}
	m.keys = keys
	m.activeKey = active
	return nil
}

func keyPairFromPrivate(priv *ecdsa.PrivateKey, createdAt time.Time) *KeyPair {
	pubBytes := append(priv.PublicKey.X.Bytes(), priv.PublicKey.Y.Bytes()...)
	hash := sha256.Sum256(pubBytes)
	kid := hex.EncodeToString(hash[:8])

	return &KeyPair{
		ID:        kid,
		Algorithm: "ES256",
		Private:   priv,
		Public:    &priv.PublicKey,
		CreatedAt: createdAt,
	}
}

func encryptPrivateKey(key []byte, privateKey *ecdsa.PrivateKey) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	scalar := privateKey.D.FillBytes(make([]byte, 32))
	ciphertext := gcm.Seal(nonce, nonce, scalar, []byte("project_alpha:ES256"))
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptPrivateKey(key []byte, encoded string) (*ecdsa.PrivateKey, error) {
	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode encrypted key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return nil, fmt.Errorf("encrypted key is truncated")
	}
	nonce, ciphertext := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	scalar, err := gcm.Open(nil, nonce, ciphertext, []byte("project_alpha:ES256"))
	if err != nil {
		return nil, fmt.Errorf("authenticate encrypted key: %w", err)
	}
	if len(scalar) != 32 {
		return nil, fmt.Errorf("decrypted P-256 private key has invalid length")
	}
	d := new(big.Int).SetBytes(scalar)
	curve := elliptic.P256()
	if d.Sign() <= 0 || d.Cmp(curve.Params().N) >= 0 {
		return nil, fmt.Errorf("decrypted P-256 private key scalar is invalid")
	}
	x, y := curve.ScalarBaseMult(scalar)
	return &ecdsa.PrivateKey{
		PublicKey: ecdsa.PublicKey{Curve: curve, X: x, Y: y},
		D:         d,
	}, nil
}

// GetActiveKey returns the current key pair for signing new tokens.
func (m *Manager) GetActiveKey() (*KeyPair, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.refreshLocked(context.Background()); err != nil {
		return nil, fmt.Errorf("refresh signing keys: %w", err)
	}

	if m.activeKey == nil {
		return nil, fmt.Errorf("no active signing key available")
	}
	return m.activeKey, nil
}

// GetKey returns a key pair by Key ID (used for token signature verification).
func (m *Manager) GetKey(kid string) (*KeyPair, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.refreshLocked(context.Background()); err != nil {
		return nil, fmt.Errorf("refresh signing keys: %w", err)
	}

	kp, ok := m.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key id %q not found", kid)
	}
	return kp, nil
}

// GetJWKS exports all public keys in standard JWKS format.
func (m *Manager) GetJWKS() (JWKS, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.refreshLocked(context.Background()); err != nil {
		return JWKS{}, fmt.Errorf("refresh signing keys: %w", err)
	}

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

	return jwks, nil
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
