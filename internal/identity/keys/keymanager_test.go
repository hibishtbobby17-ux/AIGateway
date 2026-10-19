package keys

import (
	"context"
	"strings"
	"testing"

	"project_alpha/internal/config"
	"project_alpha/internal/storage"
	"project_alpha/migrations"
)

func TestKeyManagerRotationAndJWKS(t *testing.T) {
	km, err := NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}

	key1, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("failed getting active key: %v", err)
	}
	if key1.Algorithm != "ES256" || key1.ID == "" {
		t.Errorf("unexpected active key properties: %+v", key1)
	}

	// Verify initial JWKS
	jwks, err := km.GetJWKS()
	if err != nil {
		t.Fatalf("failed getting initial JWKS: %v", err)
	}
	if len(jwks.Keys) != 1 {
		t.Fatalf("expected 1 key in JWKS, got: %d", len(jwks.Keys))
	}
	if jwks.Keys[0].Kid != key1.ID {
		t.Errorf("expected JWK kid %s, got: %s", key1.ID, jwks.Keys[0].Kid)
	}

	// Rotate key
	if err := km.RotateKey(); err != nil {
		t.Fatalf("failed rotating key: %v", err)
	}

	key2, err := km.GetActiveKey()
	if err != nil {
		t.Fatalf("failed getting new active key: %v", err)
	}
	if key2.ID == key1.ID {
		t.Errorf("expected rotated key to have new ID, but both are %s", key1.ID)
	}

	// Verify JWKS now holds both keys (key1 for verifying past tokens, key2 for new tokens)
	jwksAfter, err := km.GetJWKS()
	if err != nil {
		t.Fatalf("failed getting rotated JWKS: %v", err)
	}
	if len(jwksAfter.Keys) != 2 {
		t.Fatalf("expected 2 keys in JWKS after rotation, got: %d", len(jwksAfter.Keys))
	}

	// Verify both keys can be retrieved by kid
	k1Fetched, err := km.GetKey(key1.ID)
	if err != nil || k1Fetched == nil {
		t.Errorf("failed retrieving previous key by ID: %v", err)
	}
	k2Fetched, err := km.GetKey(key2.ID)
	if err != nil || k2Fetched == nil {
		t.Errorf("failed retrieving new key by ID: %v", err)
	}
}

func TestPersistentKeyManagerSharesAndRotatesKeysAcrossInstances(t *testing.T) {
	ctx := context.Background()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	repository, err := NewSQLRepository(db)
	if err != nil {
		t.Fatalf("create SQL repository: %v", err)
	}
	encryptionKey := []byte(strings.Repeat("e", 32))
	first, err := NewPersistentManager(ctx, repository, encryptionKey)
	if err != nil {
		t.Fatalf("create first persistent manager: %v", err)
	}
	original, err := first.GetActiveKey()
	if err != nil {
		t.Fatalf("get initial active key: %v", err)
	}

	second, err := NewPersistentManager(ctx, repository, encryptionKey)
	if err != nil {
		t.Fatalf("create second persistent manager: %v", err)
	}
	secondKey, err := second.GetActiveKey()
	if err != nil || secondKey.ID != original.ID {
		t.Fatalf("second manager did not load shared key: key=%v err=%v", secondKey, err)
	}
	if err := first.RotateKeyContext(ctx); err != nil {
		t.Fatalf("rotate persistent key: %v", err)
	}
	rotated, err := second.GetActiveKey()
	if err != nil {
		t.Fatalf("refresh second manager after rotation: %v", err)
	}
	if rotated.ID == original.ID {
		t.Fatal("second manager did not observe shared key rotation")
	}
	if _, err := second.GetKey(original.ID); err != nil {
		t.Fatalf("previous signing key was not retained for verification: %v", err)
	}
	jwks, err := second.GetJWKS()
	if err != nil || len(jwks.Keys) != 2 {
		t.Fatalf("JWKS after rotation = (%d keys, %v), want 2 keys and no error", len(jwks.Keys), err)
	}

	var stored string
	if err := db.QueryRowContext(ctx, "SELECT encrypted_private_key FROM signing_keys WHERE id = $1", original.ID).Scan(&stored); err != nil {
		t.Fatalf("read persisted private key: %v", err)
	}
	if strings.Contains(stored, original.Private.D.Text(16)) || stored == "" {
		t.Fatal("persisted key is empty or appears to contain the plaintext private scalar")
	}

	if _, err := NewPersistentManager(ctx, repository, []byte(strings.Repeat("x", 32))); err == nil {
		t.Fatal("manager accepted a different encryption key")
	}
}

func TestPersistentKeyManagerRequiresRepositoryAndEncryptionKey(t *testing.T) {
	if _, err := NewPersistentManager(context.Background(), nil, make([]byte, 32)); err == nil {
		t.Fatal("manager accepted a nil repository")
	}
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	if err := migrations.MigrateUp(context.Background(), db); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	repository, err := NewSQLRepository(db)
	if err != nil {
		t.Fatalf("create SQL repository: %v", err)
	}
	if _, err := NewPersistentManager(context.Background(), repository, make([]byte, 31)); err == nil {
		t.Fatal("manager accepted an invalid encryption key length")
	}
}
