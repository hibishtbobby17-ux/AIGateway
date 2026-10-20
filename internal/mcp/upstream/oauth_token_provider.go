package upstream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"project_alpha/internal/identity/delegation"
	"project_alpha/internal/resilience"
)

var (
	ErrMissingOAuthConfiguration = errors.New("missing mandatory oauth2 configuration (token_endpoint, client_id, and client_secret are required)")
	ErrOAuthTokenRequestFailed   = errors.New("upstream oauth token request failed")
)

type cachedToken struct {
	accessToken string
	expiresAt   time.Time
}

// OAuthTokenProvider manages M2M Client Credentials token acquisition, in-memory caching,
// and proactive renewal for upstream MCP servers.
type OAuthTokenProvider struct {
	mu         sync.RWMutex
	cache      map[string]*cachedToken
	httpClient *http.Client
	nowFunc    func() time.Time
}

// NewOAuthTokenProvider creates an OAuthTokenProvider with SSRF-safe dialer and HTTP client.
func NewOAuthTokenProvider(timeout time.Duration, allowLocalEgress bool) *OAuthTokenProvider {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &OAuthTokenProvider{
		cache:      make(map[string]*cachedToken),
		httpClient: resilience.NewSafeHTTPClient(allowLocalEgress, nil, timeout),
		nowFunc:    time.Now,
	}
}

// GetToken returns a valid cached access token or performs a client_credentials exchange.
func (p *OAuthTokenProvider) GetToken(ctx context.Context, serverID string, cfg delegation.UpstreamAuthConfig) (string, error) {
	if cfg.TokenEndpoint == "" || cfg.ClientID == "" || cfg.ClientSecret == "" {
		return "", ErrMissingOAuthConfiguration
	}

	cacheKey := fmt.Sprintf("%s:%s:%s", serverID, cfg.TokenEndpoint, cfg.ClientID)
	now := p.nowFunc()

	// 1. Check read cache
	p.mu.RLock()
	cached, ok := p.cache[cacheKey]
	if ok && cached != nil && now.Before(cached.expiresAt.Add(-60*time.Second)) {
		token := cached.accessToken
		p.mu.RUnlock()
		return token, nil
	}
	p.mu.RUnlock()

	// 2. Acquire write lock and double-check
	p.mu.Lock()
	defer p.mu.Unlock()

	now = p.nowFunc()
	cached, ok = p.cache[cacheKey]
	if ok && cached != nil && now.Before(cached.expiresAt.Add(-60*time.Second)) {
		return cached.accessToken, nil
	}

	// 3. Perform token exchange
	token, expiresIn, err := p.requestToken(ctx, cfg.TokenEndpoint, cfg.ClientID, cfg.ClientSecret, cfg.Scopes, cfg.Audience)
	if err != nil {
		return "", err
	}

	if expiresIn <= 0 {
		expiresIn = 3600
	}

	p.cache[cacheKey] = &cachedToken{
		accessToken: token,
		expiresAt:   now.Add(time.Duration(expiresIn) * time.Second),
	}

	return token, nil
}

// FetchTokenDirect performs an uncached token request to validate credentials during registration.
func (p *OAuthTokenProvider) FetchTokenDirect(ctx context.Context, tokenEndpoint, clientID, clientSecret, scopes, audience string) (map[string]any, error) {
	start := p.nowFunc()
	token, expiresIn, err := p.requestToken(ctx, tokenEndpoint, clientID, clientSecret, scopes, audience)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return map[string]any{
			"status":     "error",
			"message":    err.Error(),
			"latency_ms": latency,
		}, err
	}

	maskedToken := ""
	if len(token) > 10 {
		maskedToken = token[:6] + "..." + token[len(token)-4:]
	} else {
		maskedToken = "********"
	}

	return map[string]any{
		"status":       "ok",
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
		"token_sample": maskedToken,
		"latency_ms":   latency,
	}, nil
}

func (p *OAuthTokenProvider) requestToken(ctx context.Context, tokenEndpoint, clientID, clientSecret, scopes, audience string) (string, int, error) {
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)

	if scopes != "" {
		form.Set("scope", scopes)
	}
	if audience != "" {
		form.Set("audience", audience)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, fmt.Errorf("create oauth token request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "AI-Gateway-Upstream-OAuth/1.0")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("%w: %v", ErrOAuthTokenRequestFailed, err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(http.MaxBytesReader(nil, resp.Body, 128*1024))
	if err != nil {
		return "", 0, fmt.Errorf("read oauth response: %w", err)
	}

	var res struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}

	if err := json.Unmarshal(bodyBytes, &res); err != nil {
		return "", 0, fmt.Errorf("decode oauth response (status %d): %w", resp.StatusCode, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || res.AccessToken == "" {
		errMsg := res.Error
		if res.ErrorDesc != "" {
			errMsg = fmt.Sprintf("%s: %s", res.Error, res.ErrorDesc)
		}
		if errMsg == "" {
			errMsg = fmt.Sprintf("server returned HTTP %d", resp.StatusCode)
		}
		return "", 0, fmt.Errorf("%w: %s", ErrOAuthTokenRequestFailed, errMsg)
	}

	return res.AccessToken, res.ExpiresIn, nil
}
