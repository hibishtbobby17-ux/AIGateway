package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var (
	ErrInvalidCiphertext = errors.New("ciphertext too short or corrupted")
)

// DeriveKey produces a 32-byte AES-256 key from any secret string using SHA-256
func DeriveKey(secret string) []byte {
	hash := sha256.Sum256([]byte(secret))
	return hash[:]
}

// EncryptConfig encrypts data using AES-GCM-256 with a cryptographically random 12-byte nonce
func EncryptConfig(key []byte, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM block: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate random nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

// DecryptConfig decrypts data using AES-GCM-256. If data is unencrypted JSON, it returns it for migration.
func DecryptConfig(key []byte, data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty config data")
	}

	// Backward compatibility: If the file is plain JSON starting with '{', allow direct fallback
	if data[0] == '{' && json.Valid(data) {
		return data, nil
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM block: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, ErrInvalidCiphertext
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed (invalid key or tampered cache): %w", err)
	}

	return plaintext, nil
}

// SaveEncryptedConfig safely persists the configuration to an encrypted disk cache file
func SaveEncryptedConfig(path string, secret string, data []byte) error {
	dir := filepath.Dir(path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0750); err != nil {
			return fmt.Errorf("failed to create cache directory: %w", err)
		}
	}

	key := DeriveKey(secret)
	encrypted, err := EncryptConfig(key, data)
	if err != nil {
		return fmt.Errorf("failed to encrypt configuration: %w", err)
	}

	// Atomic write via temp file
	tmpPath := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	if err := os.WriteFile(tmpPath, encrypted, 0600); err != nil {
		return fmt.Errorf("failed to write temporary cache file: %w", err)
	}

	// On Windows, os.Rename fails if destination file already exists
	_ = os.Remove(path)
	if err := os.Rename(tmpPath, path); err != nil {
		// Fallback to direct write if rename fails on Windows file lock
		if writeErr := os.WriteFile(path, encrypted, 0600); writeErr == nil {
			_ = os.Remove(tmpPath)
			return nil
		}
		_ = os.Remove(tmpPath)
		return fmt.Errorf("failed to atomically commit cache file: %w", err)
	}

	return nil
}

// LoadEncryptedConfig loads and decrypts the cached configuration file
func LoadEncryptedConfig(path string, secret string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	key := DeriveKey(secret)
	plaintext, err := DecryptConfig(key, data)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
