package main

import (
	"crypto/tls"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateSelfSignedCert(t *testing.T) {
	cert, certPEM, keyPEM, err := GenerateSelfSignedCert("localhost", "127.0.0.1", "custom.domain.internal")
	if err != nil {
		t.Fatalf("failed to generate self-signed cert: %v", err)
	}

	if len(certPEM) == 0 || len(keyPEM) == 0 {
		t.Fatalf("PEM bytes should not be empty")
	}

	if len(cert.Certificate) == 0 {
		t.Fatalf("certificate chain should contain at least 1 leaf cert")
	}
}

func TestSetupServerTLS_AutoCert(t *testing.T) {
	opts := ServerTLSConfigOptions{
		Enabled:    true,
		AutoCert:   true,
		MinVersion: tls.VersionTLS12,
	}

	tlsConfig, err := SetupServerTLS(opts, nil)
	if err != nil {
		t.Fatalf("SetupServerTLS failed: %v", err)
	}

	if tlsConfig == nil {
		t.Fatalf("tlsConfig should not be nil when enabled")
	}

	if len(tlsConfig.Certificates) != 1 {
		t.Fatalf("expected 1 certificate, got %d", len(tlsConfig.Certificates))
	}

	if tlsConfig.MinVersion != tls.VersionTLS12 {
		t.Fatalf("expected MinVersion TLS 1.2, got %x", tlsConfig.MinVersion)
	}
}

func TestSetupServerTLS_CustomCertFiles(t *testing.T) {
	_, certPEM, keyPEM, err := GenerateSelfSignedCert("localhost")
	if err != nil {
		t.Fatalf("cert generation failed: %v", err)
	}

	tmpDir := t.TempDir()
	certFile := filepath.Join(tmpDir, "server.crt")
	keyFile := filepath.Join(tmpDir, "server.key")

	if err := os.WriteFile(certFile, certPEM, 0600); err != nil {
		t.Fatalf("failed to write cert file: %v", err)
	}
	if err := os.WriteFile(keyFile, keyPEM, 0600); err != nil {
		t.Fatalf("failed to write key file: %v", err)
	}

	opts := ServerTLSConfigOptions{
		Enabled:    true,
		CertFile:   certFile,
		KeyFile:    keyFile,
		MinVersion: tls.VersionTLS13,
	}

	tlsConfig, err := SetupServerTLS(opts, nil)
	if err != nil {
		t.Fatalf("SetupServerTLS with files failed: %v", err)
	}

	if tlsConfig.MinVersion != tls.VersionTLS13 {
		t.Fatalf("expected MinVersion TLS 1.3, got %x", tlsConfig.MinVersion)
	}
}

func TestSetupDownstreamTLS(t *testing.T) {
	_, certPEM, keyPEM, err := GenerateSelfSignedCert("mcp.internal")
	if err != nil {
		t.Fatalf("cert generation failed: %v", err)
	}

	tmpDir := t.TempDir()
	caFile := filepath.Join(tmpDir, "ca.crt")
	clientCertFile := filepath.Join(tmpDir, "client.crt")
	clientKeyFile := filepath.Join(tmpDir, "client.key")

	_ = os.WriteFile(caFile, certPEM, 0600)
	_ = os.WriteFile(clientCertFile, certPEM, 0600)
	_ = os.WriteFile(clientKeyFile, keyPEM, 0600)

	opts := DownstreamTLSConfigOptions{
		CACertFile:         caFile,
		InsecureSkipVerify: true,
		ClientCertFile:     clientCertFile,
		ClientKeyFile:      clientKeyFile,
		MinVersion:         tls.VersionTLS12,
	}

	clientTLS, err := SetupDownstreamTLS(opts, nil)
	if err != nil {
		t.Fatalf("SetupDownstreamTLS failed: %v", err)
	}

	if !clientTLS.InsecureSkipVerify {
		t.Fatalf("expected InsecureSkipVerify=true")
	}

	if len(clientTLS.Certificates) != 1 {
		t.Fatalf("expected 1 client mTLS certificate loaded, got %d", len(clientTLS.Certificates))
	}

	if clientTLS.RootCAs == nil {
		t.Fatalf("expected non-nil RootCAs")
	}
}

func TestRequestScheme(t *testing.T) {
	req := httptest.NewRequest("GET", "http://example.com/test", nil)
	if scheme := RequestScheme(req, false); scheme != "http" {
		t.Fatalf("expected http, got %s", scheme)
	}

	if scheme := RequestScheme(req, true); scheme != "https" {
		t.Fatalf("expected https when server TLS is true, got %s", scheme)
	}

	req.Header.Set("X-Forwarded-Proto", "https")
	if scheme := RequestScheme(req, false); scheme != "https" {
		t.Fatalf("expected https with X-Forwarded-Proto, got %s", scheme)
	}
}
