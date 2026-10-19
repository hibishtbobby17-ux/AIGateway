package oauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
)

var (
	ErrInvalidClient        = errors.New("invalid client credentials")
	ErrInvalidGrant         = errors.New("invalid or expired authorization grant")
	ErrInvalidPKCEVerifier  = errors.New("code_verifier failed S256 PKCE verification")
	ErrUnsupportedGrantType = errors.New("unsupported grant_type")
	ErrInvalidRedirectURI   = errors.New("redirect_uri does not match client registration")
	ErrClientAlreadyExists  = errors.New("oauth client already registered")
	ErrAuthorizationDenied  = errors.New("user authorization was denied")
)

// Client represents a tenant-scoped OAuth client registration.
type Client struct {
	ID                string   `json:"id"`
	ClientID          string   `json:"client_id"`
	ClientSecret      string   `json:"-"` // Accepted only at registration; the server persists a password hash.
	ClientType        string   `json:"client_type"`
	TenantID          string   `json:"tenant_id"`
	RedirectURIs      []string `json:"redirect_uris"`
	AllowedGrantTypes []string `json:"allowed_grant_types"`
	AllowedScopes     []string `json:"allowed_scopes"`
}

// AuthorizationDecision is the result of authenticating a resource owner and
// resolving consent. Its subject and scopes must come from trusted server-side
// identity and consent state, never from query parameters.
type AuthorizationDecision struct {
	Subject string
	Scopes  []string
}

// AuthorizationService authenticates the resource owner and returns the
// scopes they approved for this client.
type AuthorizationService interface {
	Authorize(context.Context, *http.Request, *Client, []string) (AuthorizationDecision, error)
}

// TokenResponse contains the access token fields used by OAuth clients.
type TokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Scope       string `json:"scope,omitempty"`
}

func validRedirectURI(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Fragment != "" || parsed.User != nil {
		return false
	}
	if (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host == "" {
		return false
	}
	return true
}

func validScope(scope string) bool {
	if scope == "" {
		return false
	}
	for _, r := range scope {
		if r < 0x21 || r > 0x7e || r == '"' || r == '\\' {
			return false
		}
	}
	return true
}

func scopesSubset(scopes, allowed []string) bool {
	seen := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		if !validScope(scope) || !contains(allowed, scope) {
			return false
		}
		if _, exists := seen[scope]; exists {
			return false
		}
		seen[scope] = struct{}{}
	}
	return true
}

func contains(list []string, item string) bool {
	for _, value := range list {
		if value == item {
			return true
		}
	}
	return false
}

func containsArgument(arguments []string, value string) bool {
	for _, argument := range arguments {
		if argument == value {
			return true
		}
	}
	return false
}
