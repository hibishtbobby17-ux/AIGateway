package delegation

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/identity/tokens"
)

var (
	ErrPrincipalRequiredForDelegation = errors.New("authenticated principal is required for delegated token exchange")
	ErrTokenRelayBlocked              = errors.New("security violation: raw inbound client token relay is strictly prohibited")
	ErrInvalidAuthConfig              = errors.New("invalid upstream authentication configuration")
	ErrMissingTargetAudience          = errors.New("target audience is required for downstream token exchange")
)

const (
	TypeNone                    = "NONE"
	TypeStaticBearer            = "STATIC_BEARER"
	TypeBasic                   = "BASIC"
	TypeAPIKey                  = "API_KEY"
	TypeDelegatedTokenExchange  = "DELEGATED_TOKEN_EXCHANGE"
	TypeOAuth2ClientCredentials = "OAUTH2_CLIENT_CREDENTIALS"
)

// Credential represents an outbound credential to attach to an upstream request.
type Credential interface {
	Type() string
	Apply(req *http.Request)
	HeaderValue() string
}

// NoopCredential attaches no credentials.
type NoopCredential struct{}

func (c NoopCredential) Type() string                { return TypeNone }
func (c NoopCredential) Apply(req *http.Request)     {}
func (c NoopCredential) HeaderValue() string         { return "" }

// BearerCredential attaches a Bearer authorization token.
type BearerCredential struct {
	Token       string
	IsDelegated bool
}

func (c BearerCredential) Type() string {
	if c.IsDelegated {
		return TypeDelegatedTokenExchange
	}
	return TypeStaticBearer
}

func (c BearerCredential) Apply(req *http.Request) {
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
}

func (c BearerCredential) HeaderValue() string {
	if c.Token == "" {
		return ""
	}
	return "Bearer " + c.Token
}

// BasicCredential attaches HTTP Basic authorization.
type BasicCredential struct {
	Username string
	Password string
}

func (c BasicCredential) Type() string { return TypeBasic }

func (c BasicCredential) Apply(req *http.Request) {
	auth := c.Username + ":" + c.Password
	encoded := base64.StdEncoding.EncodeToString([]byte(auth))
	req.Header.Set("Authorization", "Basic "+encoded)
}

func (c BasicCredential) HeaderValue() string {
	auth := c.Username + ":" + c.Password
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(auth))
}

// APIKeyCredential attaches a custom API key header.
type APIKeyCredential struct {
	HeaderName string
	Key        string
}

func (c APIKeyCredential) Type() string { return TypeAPIKey }

func (c APIKeyCredential) Apply(req *http.Request) {
	header := c.HeaderName
	if header == "" {
		header = "X-API-Key"
	}
	req.Header.Set(header, c.Key)
}

func (c APIKeyCredential) HeaderValue() string {
	return c.Key
}

// UpstreamAuthConfig holds downstream authentication settings for an upstream server.
type UpstreamAuthConfig struct {
	Type            string   `json:"type"`
	StaticToken     string   `json:"static_token,omitempty"`
	Username        string   `json:"username,omitempty"`
	Password        string   `json:"password,omitempty"`
	APIKey          string   `json:"api_key,omitempty"`
	APIKeyHeader    string   `json:"api_key_header,omitempty"`
	Audience        string   `json:"audience,omitempty"`
	RequestedScopes []string `json:"requested_scopes,omitempty"`
	// OAuth2 Client Credentials fields
	TokenEndpoint   string   `json:"token_endpoint,omitempty"`
	ClientID        string   `json:"client_id,omitempty"`
	ClientSecret    string   `json:"client_secret,omitempty"`
	Scopes          string   `json:"scopes,omitempty"`
}

// TokenExchanger creates short-lived, downstream-scoped tokens for upstream servers (RFC 8693).
type TokenExchanger struct {
	keyManager *keys.Manager
	issuer     string
	lifetime   time.Duration
}

// NewTokenExchanger creates a new token exchanger.
func NewTokenExchanger(keyManager *keys.Manager, issuer string, lifetime time.Duration) (*TokenExchanger, error) {
	if keyManager == nil {
		return nil, errors.New("key manager is required for token exchanger")
	}
	if issuer == "" {
		return nil, errors.New("issuer is required for token exchanger")
	}
	if lifetime <= 0 {
		lifetime = 5 * time.Minute
	}
	return &TokenExchanger{
		keyManager: keyManager,
		issuer:     issuer,
		lifetime:   lifetime,
	}, nil
}

// Exchange issues a downstream-scoped JWT for an authenticated caller.
func (te *TokenExchanger) Exchange(ctx context.Context, p principal.Principal, targetAudience string, requestedScopes []string) (string, error) {
	if p.Subject == "" || p.TenantID == "" {
		return "", ErrPrincipalRequiredForDelegation
	}
	if targetAudience == "" {
		return "", ErrMissingTargetAudience
	}

	activeKey, err := te.keyManager.GetActiveKey()
	if err != nil {
		return "", fmt.Errorf("active signing key unavailable: %w", err)
	}

	tokenIDBytes := make([]byte, 16)
	if _, err := rand.Read(tokenIDBytes); err != nil {
		return "", fmt.Errorf("generate token id: %w", err)
	}
	tokenID := hex.EncodeToString(tokenIDBytes)

	now := time.Now().UTC()
	grantedScopes := requestedScopes
	if len(grantedScopes) == 0 {
		grantedScopes = p.Scopes
	}

	claims := &tokens.Claims{
		Issuer:   te.issuer,
		Subject:  p.Subject,
		Audience: targetAudience,
		TenantID: p.TenantID,
		Scopes:   grantedScopes,
		Roles:    append([]string(nil), p.Roles...),
		Attributes: map[string]any{
			"act": map[string]any{
				"sub": "ai-gateway",
			},
		},
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(te.lifetime).Unix(),
		TokenID:   tokenID,
	}

	return tokens.Sign(claims, activeKey)
}

// CredentialProvider resolves and issues credentials for upstream calls.
type CredentialProvider interface {
	Resolve(ctx context.Context, serverID string, cfg UpstreamAuthConfig) (Credential, error)
}

// OAuthTokenFetcher obtains automated M2M access tokens for upstream servers.
type OAuthTokenFetcher interface {
	GetToken(ctx context.Context, serverID string, cfg UpstreamAuthConfig) (string, error)
}

// Provider implements CredentialProvider with anti-relay validation.
type Provider struct {
	exchanger    *TokenExchanger
	oauthFetcher OAuthTokenFetcher
}

// NewProvider creates a new delegation credential provider.
func NewProvider(exchanger *TokenExchanger) *Provider {
	return &Provider{exchanger: exchanger}
}

// SetOAuthTokenFetcher configures an upstream OAuth2 token fetcher.
func (p *Provider) SetOAuthTokenFetcher(fetcher OAuthTokenFetcher) {
	p.oauthFetcher = fetcher
}

// Resolve resolves the appropriate outbound credential for the given upstream configuration.
func (p *Provider) Resolve(ctx context.Context, serverID string, cfg UpstreamAuthConfig) (Credential, error) {
	authType := strings.ToUpper(strings.TrimSpace(cfg.Type))
	if authType == "" || authType == TypeNone {
		return NoopCredential{}, nil
	}

	switch authType {
	case TypeStaticBearer:
		if cfg.StaticToken == "" {
			return nil, fmt.Errorf("%w: static_token required for STATIC_BEARER", ErrInvalidAuthConfig)
		}
		return BearerCredential{Token: cfg.StaticToken, IsDelegated: false}, nil

	case TypeBasic:
		return BasicCredential{Username: cfg.Username, Password: cfg.Password}, nil

	case TypeAPIKey:
		if cfg.APIKey == "" {
			return nil, fmt.Errorf("%w: api_key required for API_KEY", ErrInvalidAuthConfig)
		}
		return APIKeyCredential{HeaderName: cfg.APIKeyHeader, Key: cfg.APIKey}, nil

	case TypeDelegatedTokenExchange:
		if p.exchanger == nil {
			return nil, errors.New("token exchanger is not configured on credential provider")
		}
		caller, ok := principal.FromContext(ctx)
		if !ok || caller.Subject == "" {
			return nil, ErrPrincipalRequiredForDelegation
		}
		targetAudience := cfg.Audience
		if targetAudience == "" {
			targetAudience = serverID
		}
		token, err := p.exchanger.Exchange(ctx, caller, targetAudience, cfg.RequestedScopes)
		if err != nil {
			return nil, fmt.Errorf("token exchange failed: %w", err)
		}
		return BearerCredential{Token: token, IsDelegated: true}, nil

	case TypeOAuth2ClientCredentials:
		if p.oauthFetcher == nil {
			return nil, errors.New("oauth token fetcher is not configured on credential provider")
		}
		token, err := p.oauthFetcher.GetToken(ctx, serverID, cfg)
		if err != nil {
			return nil, fmt.Errorf("oauth2 token acquisition failed: %w", err)
		}
		return BearerCredential{Token: token, IsDelegated: false}, nil

	default:
		return nil, fmt.Errorf("%w: unknown auth type %q", ErrInvalidAuthConfig, cfg.Type)
	}
}

// ValidateAntiRelay verifies that an inbound caller's raw bearer token is never re-used
// as the outbound credential.
func ValidateAntiRelay(inboundRawToken string, outbound Credential) error {
	if inboundRawToken == "" || outbound == nil {
		return nil
	}
	cleanInbound := strings.TrimSpace(strings.TrimPrefix(inboundRawToken, "Bearer "))
	cleanInbound = strings.TrimSpace(cleanInbound)
	if cleanInbound == "" {
		return nil
	}

	outVal := outbound.HeaderValue()
	if strings.Contains(outVal, cleanInbound) {
		return ErrTokenRelayBlocked
	}
	return nil
}

type inboundTokenKey struct{}

// WithInboundToken attaches the inbound caller raw bearer token to context for anti-relay checking.
func WithInboundToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, inboundTokenKey{}, token)
}

// InboundTokenFromContext extracts the inbound caller raw bearer token from context.
func InboundTokenFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(inboundTokenKey{}).(string); ok {
		return v
	}
	return ""
}
