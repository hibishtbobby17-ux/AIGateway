package config

import (
	"os"
	"strings"
	"testing"
)

func TestDefaultConfigValid(t *testing.T) {
	cfg := NewDefaultConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected default config to be valid, got: %v", err)
	}
}

func TestConfigValidationInvalidPorts(t *testing.T) {
	cfg := NewDefaultConfig()
	cfg.Server.Port = -1
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "invalid server port") {
		t.Fatalf("expected error for invalid server port, got: %v", err)
	}

	cfg = NewDefaultConfig()
	cfg.Admin.Port = 8080 // same as Server.Port
	err = cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "cannot be identical") {
		t.Fatalf("expected error for identical server and admin ports, got: %v", err)
	}
}

func TestConfigValidationProductionSecurity(t *testing.T) {
	cfg := NewDefaultConfig()
	cfg.Environment = EnvProduction
	cfg.Security.AllowLocalEgress = true

	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "allow_local_egress cannot be enabled in production") {
		t.Fatalf("expected error for local egress in production, got: %v", err)
	}

	cfg.Security.AllowLocalEgress = false
	cfg.Security.EncryptionKey = "too_short"
	err = cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "encryption_key must be at least 32 characters") {
		t.Fatalf("expected error for short encryption key in production, got: %v", err)
	}
}

func TestConfigLoadFromEnv(t *testing.T) {
	os.Setenv("GATEWAY_SERVER_PORT", "9090")
	os.Setenv("GATEWAY_ADMIN_PORT", "9091")
	os.Setenv("GATEWAY_JWT_ISSUER", "https://auth.enterprise.com")
	defer func() {
		os.Unsetenv("GATEWAY_SERVER_PORT")
		os.Unsetenv("GATEWAY_ADMIN_PORT")
		os.Unsetenv("GATEWAY_JWT_ISSUER")
	}()

	cfg := NewDefaultConfig()
	cfg.LoadFromEnv()

	if cfg.Server.Port != 9090 {
		t.Errorf("expected Server.Port to be 9090, got: %d", cfg.Server.Port)
	}
	if cfg.Admin.Port != 9091 {
		t.Errorf("expected Admin.Port to be 9091, got: %d", cfg.Admin.Port)
	}
	if cfg.Security.JWTIssuer != "https://auth.enterprise.com" {
		t.Errorf("expected JWTIssuer to be updated, got: %s", cfg.Security.JWTIssuer)
	}
}
