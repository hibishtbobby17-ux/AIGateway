package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment represents deployment environment.
type Environment string

const (
	EnvDevelopment Environment = "development"
	EnvStaging     Environment = "staging"
	EnvProduction  Environment = "production"
)

// Config represents the complete application configuration hierarchy.
type Config struct {
	Environment Environment      `json:"environment" yaml:"environment"`
	Server      ServerConfig     `json:"server" yaml:"server"`
	Admin       AdminConfig      `json:"admin" yaml:"admin"`
	Security    SecurityConfig   `json:"security" yaml:"security"`
	Database    DatabaseConfig   `json:"database" yaml:"database"`
	Telemetry   TelemetryConfig  `json:"telemetry" yaml:"telemetry"`
	Resilience  ResilienceConfig `json:"resilience" yaml:"resilience"`
}

// ServerConfig defines the public gateway proxy server configuration.
type ServerConfig struct {
	Host         string        `json:"host" yaml:"host"`
	Port         int           `json:"port" yaml:"port"`
	ReadTimeout  time.Duration `json:"read_timeout" yaml:"read_timeout"`
	WriteTimeout time.Duration `json:"write_timeout" yaml:"write_timeout"`
	IdleTimeout  time.Duration `json:"idle_timeout" yaml:"idle_timeout"`
}

// AdminConfig defines the administrative API and control-plane server configuration.
type AdminConfig struct {
	Host string `json:"host" yaml:"host"`
	Port int    `json:"port" yaml:"port"`
}

// SecurityConfig holds secret keys, encryption keys, and network safety parameters.
type SecurityConfig struct {
	EncryptionKey              string   `json:"encryption_key" yaml:"encryption_key"` // 32-byte hex for AES-256
	SigningKeyEncryptionKeyHex string   `json:"-" yaml:"-"`                           // 32-byte hex supplied out of band
	JWTIssuer                  string   `json:"jwt_issuer" yaml:"jwt_issuer"`
	AllowLocalEgress           bool     `json:"allow_local_egress" yaml:"allow_local_egress"` // Prohibited in production
	EgressAllowedCIDRs         []string `json:"egress_allowed_cidrs" yaml:"egress_allowed_cidrs"`
}

// DatabaseConfig holds PostgreSQL or SQLite connection parameters.
type DatabaseConfig struct {
	Driver          string        `json:"driver" yaml:"driver"` // "postgres" or "sqlite"
	URL             string        `json:"url" yaml:"url"`
	MaxConns        int32         `json:"max_conns" yaml:"max_conns"`
	MinConns        int32         `json:"min_conns" yaml:"min_conns"`
	MaxConnIdleTime time.Duration `json:"max_conn_idle_time" yaml:"max_conn_idle_time"`
	MaxConnLifetime time.Duration `json:"max_conn_lifetime" yaml:"max_conn_lifetime"`
}

// TelemetryConfig holds OTLP and storage endpoints.
type TelemetryConfig struct {
	OTLPHTTPPort   int    `json:"otlp_http_port" yaml:"otlp_http_port"`
	OTLPGRPCPort   int    `json:"otlp_grpc_port" yaml:"otlp_grpc_port"`
	ClickHouseURL  string `json:"clickhouse_url" yaml:"clickhouse_url"`
	PrometheusPort int    `json:"prometheus_port" yaml:"prometheus_port"`
}

// ResilienceConfig holds defaults for bulkheads and rate limits.
type ResilienceConfig struct {
	DefaultUpstreamTimeoutMs int `json:"default_upstream_timeout_ms" yaml:"default_upstream_timeout_ms"`
	DefaultConcurrencyLimit  int `json:"default_concurrency_limit" yaml:"default_concurrency_limit"`
}

// NewDefaultConfig returns a configuration pre-populated with safe defaults.
func NewDefaultConfig() *Config {
	return &Config{
		Environment: EnvDevelopment,
		Server: ServerConfig{
			Host:         "0.0.0.0",
			Port:         8080,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
		Admin: AdminConfig{
			Host: "0.0.0.0",
			Port: 8081,
		},
		Security: SecurityConfig{
			JWTIssuer:        "https://gateway.local",
			AllowLocalEgress: false,
		},
		Database: DatabaseConfig{
			Driver:          "postgres",
			URL:             "postgres://gateway:gateway@localhost:5432/gateway_dev?sslmode=disable",
			MaxConns:        25,
			MinConns:        5,
			MaxConnIdleTime: 15 * time.Minute,
			MaxConnLifetime: 1 * time.Hour,
		},
		Telemetry: TelemetryConfig{
			OTLPHTTPPort:   4318,
			OTLPGRPCPort:   4317,
			ClickHouseURL:  "http://localhost:8123/default",
			PrometheusPort: 9090,
		},
		Resilience: ResilienceConfig{
			DefaultUpstreamTimeoutMs: 10000,
			DefaultConcurrencyLimit:  50,
		},
	}
}

// LoadFromEnv loads configuration overrides from standard GATEWAY_ environment variables.
func (c *Config) LoadFromEnv() {
	if v := os.Getenv("GATEWAY_ENVIRONMENT"); v != "" {
		c.Environment = Environment(strings.ToLower(v))
	}
	if v := os.Getenv("GATEWAY_SERVER_HOST"); v != "" {
		c.Server.Host = v
	}
	if v := os.Getenv("GATEWAY_SERVER_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil && port > 0 {
			c.Server.Port = port
		}
	}
	if v := os.Getenv("GATEWAY_ADMIN_HOST"); v != "" {
		c.Admin.Host = v
	}
	if v := os.Getenv("GATEWAY_ADMIN_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil && port > 0 {
			c.Admin.Port = port
		}
	}
	if v := os.Getenv("GATEWAY_ENCRYPTION_KEY"); v != "" {
		c.Security.EncryptionKey = v
	}
	if v := os.Getenv("GATEWAY_SIGNING_KEY_ENCRYPTION_KEY"); v != "" {
		c.Security.SigningKeyEncryptionKeyHex = v
	}
	if v := os.Getenv("GATEWAY_JWT_ISSUER"); v != "" {
		c.Security.JWTIssuer = v
	}
	if v := os.Getenv("GATEWAY_ALLOW_LOCAL_EGRESS"); v != "" {
		c.Security.AllowLocalEgress = strings.ToLower(v) == "true" || v == "1"
	}
	if v := os.Getenv("GATEWAY_DATABASE_DRIVER"); v != "" {
		c.Database.Driver = strings.ToLower(v)
	}
	if v := os.Getenv("GATEWAY_DATABASE_URL"); v != "" {
		c.Database.URL = v
	}

	// Auto-detect driver if not explicitly set
	if c.Database.Driver == "" {
		if strings.HasPrefix(c.Database.URL, "sqlite:") || strings.HasPrefix(c.Database.URL, "file:") || c.Database.URL == ":memory:" {
			c.Database.Driver = "sqlite"
		} else {
			c.Database.Driver = "postgres"
		}
	}
}

// Validate executes strict fail-fast validation on the configuration.
func (c *Config) Validate() error {
	var errs []string

	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		errs = append(errs, fmt.Sprintf("invalid server port: %d (must be between 1 and 65535)", c.Server.Port))
	}
	if c.Admin.Port <= 0 || c.Admin.Port > 65535 {
		errs = append(errs, fmt.Sprintf("invalid admin port: %d (must be between 1 and 65535)", c.Admin.Port))
	}
	if c.Server.Port == c.Admin.Port {
		errs = append(errs, fmt.Sprintf("server port and admin port cannot be identical (%d)", c.Server.Port))
	}

	if c.Database.URL == "" {
		errs = append(errs, "database url cannot be empty")
	}

	driver := strings.ToLower(c.Database.Driver)
	if driver != "postgres" && driver != "sqlite" && driver != "" {
		errs = append(errs, fmt.Sprintf("unsupported database driver: %q (must be 'postgres' or 'sqlite')", c.Database.Driver))
	}

	if c.Security.JWTIssuer == "" {
		errs = append(errs, "jwt_issuer cannot be empty")
	}
	if c.Security.SigningKeyEncryptionKeyHex != "" {
		if _, err := c.SigningKeyEncryptionKey(); err != nil {
			errs = append(errs, err.Error())
		}
	}

	// In production, enforce cryptographic requirements and security boundaries
	if c.Environment == EnvProduction {
		if c.Database.Driver == "sqlite" {
			errs = append(errs, "security violation: sqlite driver is only permitted in development/test, postgres required in production")
		}
		if c.Security.AllowLocalEgress {
			errs = append(errs, "security violation: allow_local_egress cannot be enabled in production environment")
		}
		if len(c.Security.EncryptionKey) < 32 {
			errs = append(errs, "security violation: encryption_key must be at least 32 characters in production")
		}
		if strings.Contains(c.Database.URL, "sslmode=disable") {
			errs = append(errs, "security violation: database sslmode=disable is forbidden in production")
		}
	}

	if len(errs) > 0 {
		return errors.New("configuration validation errors: " + strings.Join(errs, "; "))
	}
	return nil
}

// SigningKeyEncryptionKey decodes the out-of-band 256-bit key used to encrypt
// persisted signing keys. It is intentionally not serialized in config output.
func (c *Config) SigningKeyEncryptionKey() ([]byte, error) {
	if c.Security.SigningKeyEncryptionKeyHex == "" {
		return nil, errors.New("signing key encryption key is not configured")
	}
	key, err := hex.DecodeString(c.Security.SigningKeyEncryptionKeyHex)
	if err != nil || len(key) != 32 {
		return nil, errors.New("signing key encryption key must be exactly 64 hexadecimal characters (32 bytes)")
	}
	return key, nil
}
