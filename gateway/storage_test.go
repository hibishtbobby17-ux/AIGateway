package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStorageEncryptionRoundTrip(t *testing.T) {
	secret := "aigw_live_a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
	key := DeriveKey(secret)

	payload := []byte(`{"version":"v140","routes":[{"id":"route_1"}]}`)

	encrypted, err := EncryptConfig(key, payload)
	if err != nil {
		t.Fatalf("failed to encrypt: %v", err)
	}

	decrypted, err := DecryptConfig(key, encrypted)
	if err != nil {
		t.Fatalf("failed to decrypt: %v", err)
	}

	if string(decrypted) != string(payload) {
		t.Errorf("decrypted payload mismatch, expected %s, got %s", payload, decrypted)
	}
}

func TestStorageTamperedData(t *testing.T) {
	secret := "aigw_live_test_secret_1234567890abcdef"
	key := DeriveKey(secret)

	payload := []byte(`{"version":"v140"}`)
	encrypted, err := EncryptConfig(key, payload)
	if err != nil {
		t.Fatalf("failed to encrypt: %v", err)
	}

	// Tamper with last byte
	encrypted[len(encrypted)-1] ^= 0xFF

	_, err = DecryptConfig(key, encrypted)
	if err == nil {
		t.Errorf("expected decryption error on tampered data, got nil")
	}
}

func TestStorageLegacyJSONBackwardCompatibility(t *testing.T) {
	secret := "aigw_live_test_secret_1234567890abcdef"
	key := DeriveKey(secret)

	legacyJSON := []byte(`{"config_version":1,"projects":{}}`)
	decrypted, err := DecryptConfig(key, legacyJSON)
	if err != nil {
		t.Fatalf("failed to parse legacy JSON: %v", err)
	}

	if string(decrypted) != string(legacyJSON) {
		t.Errorf("expected %s, got %s", legacyJSON, decrypted)
	}
}

func TestStorageSaveAndLoadEncryptedFile(t *testing.T) {
	tmpDir := t.TempDir()
	cachePath := filepath.Join(tmpDir, "sub", "cache.db")
	secret := "aigw_live_super_secret_key_abcdef123456"

	data := []byte(`{"config_version":140,"updated":"2026-10-26"}`)

	if err := SaveEncryptedConfig(cachePath, secret, data); err != nil {
		t.Fatalf("failed to save encrypted config: %v", err)
	}

	loaded, err := LoadEncryptedConfig(cachePath, secret)
	if err != nil {
		t.Fatalf("failed to load encrypted config: %v", err)
	}

	if string(loaded) != string(data) {
		t.Errorf("expected %s, got %s", data, loaded)
	}

	// Verify file is actually encrypted on disk and not raw plaintext
	rawDiskData, err := os.ReadFile(cachePath)
	if err != nil {
		t.Fatalf("failed to read disk file: %v", err)
	}

	if rawDiskData[0] == '{' {
		t.Errorf("file on disk should be encrypted binary, but starts with '{'")
	}
}
