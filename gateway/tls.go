package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
	"crypto/tls"
)

// ServerTLSConfigOptions defines inbound TLS options for the AI Gateway data plane.
type ServerTLSConfigOptions struct {
	Enabled       bool
	CertFile      string
	KeyFile       string
	AutoCert      bool
	ClientAuth    tls.ClientAuthType
	ClientCAFile  string
	MinVersion    uint16
}

// DownstreamTLSConfigOptions defines outbound TLS options for connections to downstream MCP servers.
type DownstreamTLSConfigOptions struct {
	CACertFile         string
	InsecureSkipVerify bool
	ClientCertFile     string
	ClientKeyFile      string
	MinVersion         uint16
}

// LoadServerTLSOptionsFromEnv loads inbound TLS options from environment variables.
func LoadServerTLSOptionsFromEnv() ServerTLSConfigOptions {
	enabled := strings.EqualFold(os.Getenv("GATEWAY_TLS_ENABLED"), "true") ||
		os.Getenv("GATEWAY_TLS_ENABLED") == "1" ||
		os.Getenv("GATEWAY_TLS_CERT_FILE") != ""

	certFile := os.Getenv("GATEWAY_TLS_CERT_FILE")
	keyFile := os.Getenv("GATEWAY_TLS_KEY_FILE")

	autoCert := strings.EqualFold(os.Getenv("GATEWAY_TLS_AUTO_CERT"), "true") ||
		(enabled && (certFile == "" || keyFile == ""))

	clientAuth := tls.NoClientCert
	switch strings.ToLower(os.Getenv("GATEWAY_TLS_CLIENT_AUTH")) {
	case "request":
		clientAuth = tls.RequestClientCert
	case "require":
		clientAuth = tls.RequireAnyClientCert
	case "verify", "require_and_verify":
		clientAuth = tls.RequireAndVerifyClientCert
	}

	minVersion := uint16(tls.VersionTLS12)
	if strings.ToLower(os.Getenv("GATEWAY_TLS_MIN_VERSION")) == "tls13" {
		minVersion = tls.VersionTLS13
	}

	return ServerTLSConfigOptions{
		Enabled:      enabled,
		CertFile:     certFile,
		KeyFile:      keyFile,
		AutoCert:     autoCert,
		ClientAuth:   clientAuth,
		ClientCAFile: os.Getenv("GATEWAY_TLS_CLIENT_CA_FILE"),
		MinVersion:   minVersion,
	}
}

// LoadDownstreamTLSOptionsFromEnv loads outbound downstream TLS options from environment variables.
func LoadDownstreamTLSOptionsFromEnv() DownstreamTLSConfigOptions {
	insecure := strings.EqualFold(os.Getenv("DOWNSTREAM_INSECURE_SKIP_VERIFY"), "true") ||
		os.Getenv("DOWNSTREAM_INSECURE_SKIP_VERIFY") == "1"

	minVersion := uint16(tls.VersionTLS12)
	if strings.ToLower(os.Getenv("DOWNSTREAM_TLS_MIN_VERSION")) == "tls13" {
		minVersion = tls.VersionTLS13
	}

	return DownstreamTLSConfigOptions{
		CACertFile:         os.Getenv("DOWNSTREAM_CA_CERT_FILE"),
		InsecureSkipVerify: insecure,
		ClientCertFile:     os.Getenv("DOWNSTREAM_CLIENT_CERT_FILE"),
		ClientKeyFile:      os.Getenv("DOWNSTREAM_CLIENT_KEY_FILE"),
		MinVersion:         minVersion,
	}
}

// SetupServerTLS creates a hardened *tls.Config for the Gateway HTTP server.
func SetupServerTLS(opts ServerTLSConfigOptions, logger *slog.Logger) (*tls.Config, error) {
	if !opts.Enabled {
		return nil, nil
	}
	if logger == nil {
		logger = slog.Default()
	}

	tlsConfig := &tls.Config{
		MinVersion: opts.MinVersion,
		NextProtos: []string{"h2", "http/1.1"},
		CipherSuites: []uint16{
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
		},
	}

	// 1. Load or generate certificate
	if opts.CertFile != "" && opts.KeyFile != "" {
		cert, err := tls.LoadX509KeyPair(opts.CertFile, opts.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load inbound TLS keypair (%s, %s): %w", opts.CertFile, opts.KeyFile, err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
		logger.Info("inbound TLS certificate loaded successfully", "cert_file", opts.CertFile)
	} else if opts.AutoCert {
		logger.Info("generating ephemeral self-signed ECDSA certificate for inbound TLS...")
		cert, _, _, err := GenerateSelfSignedCert("localhost", "127.0.0.1", "::1", "ai-gateway")
		if err != nil {
			return nil, fmt.Errorf("failed to generate auto-cert: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
		logger.Info("inbound auto-cert generated successfully (SANs: localhost, 127.0.0.1, ::1, ai-gateway)")
	} else {
		return nil, errors.New("TLS enabled but neither certificate files nor auto-cert was specified")
	}

	// 2. Client Authentication (mTLS) if configured
	if opts.ClientAuth != tls.NoClientCert {
		tlsConfig.ClientAuth = opts.ClientAuth
		if opts.ClientCAFile != "" {
			caCert, err := os.ReadFile(opts.ClientCAFile)
			if err != nil {
				return nil, fmt.Errorf("failed to read client CA file %s: %w", opts.ClientCAFile, err)
			}
			caPool := x509.NewCertPool()
			if !caPool.AppendCertsFromPEM(caCert) {
				return nil, fmt.Errorf("no valid certificates found in client CA file %s", opts.ClientCAFile)
			}
			tlsConfig.ClientCAs = caPool
			logger.Info("inbound client mTLS CA pool loaded", "ca_file", opts.ClientCAFile)
		}
	}

	return tlsConfig, nil
}

// SetupDownstreamTLS creates a hardened *tls.Config for outbound HTTPS client requests to downstream MCP servers.
func SetupDownstreamTLS(opts DownstreamTLSConfigOptions, logger *slog.Logger) (*tls.Config, error) {
	if logger == nil {
		logger = slog.Default()
	}

	// Start with system root CA pool
	rootCAs, err := x509.SystemCertPool()
	if err != nil || rootCAs == nil {
		rootCAs = x509.NewCertPool()
	}

	// Append custom Downstream CA if provided
	if opts.CACertFile != "" {
		caData, err := os.ReadFile(opts.CACertFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read downstream CA file %s: %w", opts.CACertFile, err)
		}
		if !rootCAs.AppendCertsFromPEM(caData) {
			return nil, fmt.Errorf("no valid PEM certificates found in downstream CA file %s", opts.CACertFile)
		}
		logger.Info("custom downstream CA certificate bundle appended to root pool", "ca_file", opts.CACertFile)
	}

	tlsConfig := &tls.Config{
		MinVersion:         opts.MinVersion,
		RootCAs:            rootCAs,
		InsecureSkipVerify: opts.InsecureSkipVerify,
	}

	if opts.InsecureSkipVerify {
		logger.Warn("downstream TLS verification is DISABLED (DOWNSTREAM_INSECURE_SKIP_VERIFY=true). Use only in development/testing!")
	}

	// Configure client certificate for mutual TLS (mTLS) to downstreams
	if opts.ClientCertFile != "" && opts.ClientKeyFile != "" {
		clientCert, err := tls.LoadX509KeyPair(opts.ClientCertFile, opts.ClientKeyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load downstream client mTLS keypair (%s, %s): %w", opts.ClientCertFile, opts.ClientKeyFile, err)
		}
		tlsConfig.Certificates = []tls.Certificate{clientCert}
		logger.Info("downstream mTLS client certificate loaded", "cert_file", opts.ClientCertFile)
	}

	return tlsConfig, nil
}

// GenerateSelfSignedCert produces an ECDSA P-256 self-signed X.509 certificate and private key.
func GenerateSelfSignedCert(hosts ...string) (tls.Certificate, []byte, []byte, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, nil, fmt.Errorf("failed to generate ecdsa key: %w", err)
	}

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		return tls.Certificate{}, nil, nil, fmt.Errorf("failed to generate serial number: %w", err)
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"Headless AI Gateway Data Plane"},
			CommonName:   "ai-gateway",
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}

	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			template.IPAddresses = append(template.IPAddresses, ip)
		} else {
			template.DNSNames = append(template.DNSNames, h)
		}
	}

	// Ensure at least localhost SANs are present
	if len(template.IPAddresses) == 0 && len(template.DNSNames) == 0 {
		template.DNSNames = append(template.DNSNames, "localhost")
		template.IPAddresses = append(template.IPAddresses, net.ParseIP("127.0.0.1"), net.ParseIP("::1"))
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, nil, nil, fmt.Errorf("failed to create certificate: %w", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})

	privBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return tls.Certificate{}, nil, nil, fmt.Errorf("failed to marshal private key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privBytes})

	tlsCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, nil, nil, fmt.Errorf("failed to load generated x509 keypair: %w", err)
	}

	return tlsCert, certPEM, keyPEM, nil
}

// RequestScheme returns "https" or "http" based on TLS connection or forwarded headers.
func RequestScheme(r *http.Request, isServerTLS bool) string {
	if r.TLS != nil {
		return "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); strings.EqualFold(proto, "https") {
		return "https"
	}
	if proto := r.Header.Get("X-Forwarded-Scheme"); strings.EqualFold(proto, "https") {
		return "https"
	}
	if isServerTLS {
		return "https"
	}
	return "http"
}

// GetTLSTelemetry constructs a structured telemetry map of active TLS settings for heartbeat reporting.
func GetTLSTelemetry(opts ServerTLSConfigOptions, downOpts DownstreamTLSConfigOptions) map[string]interface{} {
	inboundVer := "TLS 1.2"
	if opts.MinVersion == tls.VersionTLS13 {
		inboundVer = "TLS 1.3"
	}

	downVer := "TLS 1.2"
	if downOpts.MinVersion == tls.VersionTLS13 {
		downVer = "TLS 1.3"
	}

	certMode := "none"
	if opts.Enabled {
		if opts.CertFile != "" && opts.KeyFile != "" {
			certMode = "custom_file"
		} else {
			certMode = "auto_cert"
		}
	}

	clientAuthStr := "none"
	switch opts.ClientAuth {
	case tls.RequestClientCert:
		clientAuthStr = "request"
	case tls.RequireAnyClientCert:
		clientAuthStr = "require"
	case tls.RequireAndVerifyClientCert:
		clientAuthStr = "verify"
	}

	return map[string]interface{}{
		"inbound": map[string]interface{}{
			"enabled":       opts.Enabled,
			"min_version":   inboundVer,
			"cert_mode":     certMode,
			"cert_file":     opts.CertFile,
			"sans":          []string{"localhost", "127.0.0.1", "::1", "ai-gateway"},
			"client_auth":   clientAuthStr,
			"has_client_ca": opts.ClientCAFile != "",
		},
		"downstream": map[string]interface{}{
			"insecure_skip_verify": downOpts.InsecureSkipVerify,
			"has_custom_ca":        downOpts.CACertFile != "",
			"has_client_cert":      downOpts.ClientCertFile != "" && downOpts.ClientKeyFile != "",
			"min_version":          downVer,
		},
	}
}
