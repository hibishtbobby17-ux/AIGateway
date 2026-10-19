package keys

import (
	"testing"
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
	jwks := km.GetJWKS()
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
	jwksAfter := km.GetJWKS()
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
