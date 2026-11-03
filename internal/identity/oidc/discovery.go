package oidc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"AIGateway/internal/resilience"
)

var (
	ErrInvalidIssuerURL    = errors.New("invalid external OIDC issuer URL")
	ErrDiscoveryFailed     = errors.New("OIDC discovery failed")
	ErrIssuerMismatch      = errors.New("OIDC discovery document issuer does not match configured issuer URL")
	ErrMissingEndpoints    = errors.New("OIDC discovery document missing mandatory endpoints (jwks_uri, authorization_endpoint, token_endpoint)")
)

// OpenIDConfiguration represents an OpenID Connect Provider Metadata document (RFC 8414 / OIDC Core 1.0).
type OpenIDConfiguration struct {
	Issuer                           string   `json:"issuer"`
	AuthorizationEndpoint            string   `json:"authorization_endpoint"`
	TokenEndpoint                    string   `json:"token_endpoint"`
	JWKSURI                          string   `json:"jwks_uri"`
	UserinfoEndpoint                 string   `json:"userinfo_endpoint,omitempty"`
	EndSessionEndpoint               string   `json:"end_session_endpoint,omitempty"`
	ResponseTypesSupported           []string `json:"response_types_supported,omitempty"`
	SubjectTypesSupported            []string `json:"subject_types_supported,omitempty"`
	IDTokenSigningAlgValuesSupported []string `json:"id_token_signing_alg_values_supported,omitempty"`
	ScopesSupported                  []string `json:"scopes_supported,omitempty"`
	ClaimsSupported                  []string `json:"claims_supported,omitempty"`
}

// Discoverer handles fetching and validating external OIDC provider configurations.
type Discoverer struct {
	allowLocalEgress bool
	timeout          time.Duration
}

// NewDiscoverer creates a new OIDC discovery client.
func NewDiscoverer(allowLocalEgress bool, timeout time.Duration) *Discoverer {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Discoverer{
		allowLocalEgress: allowLocalEgress,
		timeout:          timeout,
	}
}

// Discover retrieves and validates the OpenID configuration for an external issuer.
func (d *Discoverer) Discover(ctx context.Context, rawIssuerURL string) (*OpenIDConfiguration, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(rawIssuerURL), "/")
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("%w: %s", ErrInvalidIssuerURL, rawIssuerURL)
	}

	if parsed.Scheme != "https" && !(d.allowLocalEgress && parsed.Scheme == "http") {
		return nil, fmt.Errorf("%w: OIDC issuer must use HTTPS in production", ErrInvalidIssuerURL)
	}

	wellKnownURL := fmt.Sprintf("%s/.well-known/openid-configuration", trimmed)

	client := resilience.NewSafeHTTPClient(d.allowLocalEgress, nil, d.timeout)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wellKnownURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create discovery request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "AI-Gateway-OIDC-Discovery/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDiscoveryFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: server returned status %d", ErrDiscoveryFailed, resp.StatusCode)
	}

	// Bounded read (128 KB max)
	body, err := io.ReadAll(http.MaxBytesReader(nil, resp.Body, 128*1024))
	if err != nil {
		return nil, fmt.Errorf("read discovery payload: %w", err)
	}

	var config OpenIDConfiguration
	if err := json.Unmarshal(body, &config); err != nil {
		return nil, fmt.Errorf("decode discovery json: %w", err)
	}

	// Strict validation per OIDC Core spec: Issuer claim must match requested URL
	configIssuer := strings.TrimRight(strings.TrimSpace(config.Issuer), "/")
	if configIssuer != trimmed {
		return nil, fmt.Errorf("%w: document issuer %q != configured %q", ErrIssuerMismatch, config.Issuer, trimmed)
	}

	// Mandatory endpoints validation
	if config.JWKSURI == "" || config.AuthorizationEndpoint == "" || config.TokenEndpoint == "" {
		return nil, ErrMissingEndpoints
	}

	return &config, nil
}
