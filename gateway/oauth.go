package main

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var ErrReauthRequired = errors.New("reauth_required")

type JWTPayload struct {
	Issuer    string   `json:"iss"`
	Subject   string   `json:"sub"`
	Audience  string   `json:"aud"`
	ClientID  string   `json:"client_id"`
	Scope     string   `json:"scope"`
	ExpiresAt int64    `json:"exp"`
	IssuedAt  int64    `json:"iat"`
}

type JWKKey struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type JWKSResponse struct {
	Keys []JWKKey `json:"keys"`
}

type cachedJWKS struct {
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
}

type OAuthManager struct {
	consoleURL string
	gateway    *Gateway
	httpClient *http.Client
	logger     *slog.Logger

	// Inbound JWKS cache
	jwksMu    sync.RWMutex
	jwksCache map[string]cachedJWKS // key: jwks_uri

	// Outbound token cache
	tokenMu    sync.Mutex
	tokenCache map[string]cachedToken // key: server_id
	locksMu    sync.Mutex
	flightLock map[string]*sync.Mutex
}

type cachedToken struct {
	accessToken string
	expiresAt   time.Time
}

func NewOAuthManager(consoleURL string, gateway *Gateway, logger *slog.Logger) *OAuthManager {
	if logger == nil {
		logger = slog.Default()
	}
	return &OAuthManager{
		consoleURL: consoleURL,
		gateway:    gateway,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
		jwksCache:  make(map[string]cachedJWKS),
		tokenCache: make(map[string]cachedToken),
		flightLock: make(map[string]*sync.Mutex),
	}
}

// parseRSAPublicKey converts base64url n and e parameters to *rsa.PublicKey
func parseRSAPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nStr)
	if err != nil {
		return nil, fmt.Errorf("invalid JWK modulus: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eStr)
	if err != nil {
		return nil, fmt.Errorf("invalid JWK exponent: %w", err)
	}
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)
	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}

// FetchJWKS retrieves and caches public keys from an external IdP
func (m *OAuthManager) FetchJWKS(ctx context.Context, jwksURI string) (map[string]*rsa.PublicKey, error) {
	// Normalize URL for Docker network
	if strings.Contains(m.consoleURL, "console:") {
		jwksURI = strings.Replace(jwksURI, "://localhost:3000", "://console:3000", 1)
		jwksURI = strings.Replace(jwksURI, "://127.0.0.1:3000", "://console:3000", 1)
	}

	m.jwksMu.RLock()
	cached, found := m.jwksCache[jwksURI]
	m.jwksMu.RUnlock()

	if found && time.Now().Before(cached.expiresAt) {
		return cached.keys, nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", jwksURI, nil)
	if err != nil {
		return nil, err
	}

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS from %s: %w", jwksURI, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS request returned HTTP %d", resp.StatusCode)
	}

	var jwks JWKSResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode JWKS response: %w", err)
	}

	parsedKeys := make(map[string]*rsa.PublicKey)
	for _, key := range jwks.Keys {
		if key.Kty == "RSA" {
			pub, err := parseRSAPublicKey(key.N, key.E)
			if err == nil {
				parsedKeys[key.Kid] = pub
				// Also save as default if only one key
				if len(parsedKeys) == 1 {
					parsedKeys["default"] = pub
				}
			}
		}
	}

	m.jwksMu.Lock()
	m.jwksCache[jwksURI] = cachedJWKS{
		keys:      parsedKeys,
		expiresAt: time.Now().Add(5 * time.Minute),
	}
	m.jwksMu.Unlock()

	return parsedKeys, nil
}

// VerifyInboundBearer validates incoming OAuth 2.1 JWT Bearer against project InboundAuth config
func (m *OAuthManager) VerifyInboundBearer(ctx context.Context, rawToken string, auth InboundAuth) (*JWTPayload, error) {
	parts := strings.Split(rawToken, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed JWT: expected 3 dot-separated segments")
	}

	// 1. Decode Header
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid JWT header encoding: %w", err)
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("invalid JWT header JSON: %w", err)
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported JWT algorithm %q: only RS256 allowed", header.Alg)
	}

	// 2. Decode Payload
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid JWT payload encoding: %w", err)
	}
	var payload JWTPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("invalid JWT payload JSON: %w", err)
	}

	// 3. Verify Signature
	jwksURI := auth.JWKSUri
	if jwksURI == "" && auth.Issuer != "" {
		jwksURI = fmt.Sprintf("%s/.well-known/jwks.json", strings.TrimSuffix(auth.Issuer, "/"))
	}
	if jwksURI == "" {
		return nil, errors.New("no JWKS URI configured for project inbound auth")
	}

	keys, err := m.FetchJWKS(ctx, jwksURI)
	if err != nil {
		return nil, fmt.Errorf("JWKS resolution failed: %w", err)
	}

	var pubKey *rsa.PublicKey
	if header.Kid != "" {
		pubKey = keys[header.Kid]
	}
	if pubKey == nil {
		pubKey = keys["default"]
	}
	if pubKey == nil {
		return nil, fmt.Errorf("no matching RSA public key found for kid %q", header.Kid)
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid JWT signature encoding: %w", err)
	}

	hashed := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, hashed[:], sigBytes); err != nil {
		return nil, fmt.Errorf("JWT signature verification failed: %w", err)
	}

	// 4. Validate Claims
	now := time.Now().Unix()
	if payload.ExpiresAt > 0 && now > payload.ExpiresAt {
		return nil, errors.New("token has expired")
	}

	if auth.Issuer != "" {
		// Allow host normalization comparison
		normTokenIss := strings.Replace(payload.Issuer, "localhost:3000", "console:3000", 1)
		normAuthIss := strings.Replace(auth.Issuer, "localhost:3000", "console:3000", 1)
		if normTokenIss != normAuthIss && payload.Issuer != auth.Issuer {
			return nil, fmt.Errorf("issuer mismatch: expected %q, got %q", auth.Issuer, payload.Issuer)
		}
	}

	if auth.Audience != "" && payload.Audience != "" && payload.Audience != auth.Audience {
		return nil, fmt.Errorf("audience mismatch: expected %q, got %q", auth.Audience, payload.Audience)
	}

	return &payload, nil
}

// getFlightLock returns a per-key mutex for single-flight token acquisition
func (m *OAuthManager) getFlightLock(key string) *sync.Mutex {
	m.locksMu.Lock()
	defer m.locksMu.Unlock()
	lock, exists := m.flightLock[key]
	if !exists {
		lock = &sync.Mutex{}
		m.flightLock[key] = lock
	}
	return lock
}

// GetOutboundToken retrieves an outbound OAuth access token for a downstream server
func (m *OAuthManager) GetOutboundToken(ctx context.Context, server *MCPServer, forceRefresh bool) (string, error) {
	if server.AuthType != "oauth_cc" && server.AuthType != "oauth_authcode" {
		return "", nil
	}

	lockKey := server.ID
	flightLock := m.getFlightLock(lockKey)
	flightLock.Lock()
	defer flightLock.Unlock()

	// Check memory cache unless force refresh
	if !forceRefresh {
		m.tokenMu.Lock()
		cached, exists := m.tokenCache[server.ID]
		m.tokenMu.Unlock()

		if exists && time.Now().Add(60*time.Second).Before(cached.expiresAt) {
			return cached.accessToken, nil
		}
	}

	// Branch 1: OAuth Client Credentials grant
	if server.AuthType == "oauth_cc" {
		if server.OAuthConfig == nil || server.OAuthConfig.TokenEndpoint == "" {
			return "", errors.New("missing oauth_config or token_endpoint for oauth_cc server")
		}

		tokenEndpoint := server.OAuthConfig.TokenEndpoint
		if strings.Contains(m.consoleURL, "console:") {
			tokenEndpoint = strings.Replace(tokenEndpoint, "://localhost:3000", "://console:3000", 1)
			tokenEndpoint = strings.Replace(tokenEndpoint, "://127.0.0.1:3000", "://console:3000", 1)
		}

		data := url.Values{}
		data.Set("grant_type", "client_credentials")
		data.Set("client_id", server.OAuthConfig.ClientID)
		data.Set("client_secret", server.OAuthConfig.ClientSecret)
		if len(server.OAuthConfig.Scopes) > 0 {
			data.Set("scope", strings.Join(server.OAuthConfig.Scopes, " "))
		}

		req, err := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, strings.NewReader(data.Encode()))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Accept", "application/json")

		resp, err := m.httpClient.Do(req)
		if err != nil {
			return "", fmt.Errorf("oauth_cc token request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return "", fmt.Errorf("oauth_cc token endpoint returned HTTP %d: %s", resp.StatusCode, string(body))
		}

		var tokenRes struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&tokenRes); err != nil {
			return "", err
		}

		expiresIn := tokenRes.ExpiresIn
		if expiresIn <= 0 {
			expiresIn = 3600
		}

		m.tokenMu.Lock()
		m.tokenCache[server.ID] = cachedToken{
			accessToken: tokenRes.AccessToken,
			expiresAt:   time.Now().Add(time.Duration(expiresIn) * time.Second),
		}
		m.tokenMu.Unlock()

		m.logger.Info("acquired outbound client credentials token", "server", server.Name, "expires_in", expiresIn)
		return tokenRes.AccessToken, nil
	}

	// Branch 2: OAuth Authorization Code grant (managed by Console token endpoint)
	if server.AuthType == "oauth_authcode" {
		gwToken, err := m.gateway.getToken()
		if err != nil {
			return "", fmt.Errorf("cannot authenticate with console: %w", err)
		}

		reqURL := fmt.Sprintf("%s/api/gateway/v1/tokens/%s", m.consoleURL, server.ID)
		if forceRefresh {
			reqURL += "?force=true"
		}

		req, err := http.NewRequestWithContext(ctx, "POST", reqURL, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+gwToken)
		req.Header.Set("Accept", "application/json")

		resp, err := m.httpClient.Do(req)
		if err != nil {
			return "", fmt.Errorf("console token delivery request failed: %w", err)
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode == http.StatusUnauthorized {
			var errRes struct {
				Error string `json:"error"`
			}
			_ = json.Unmarshal(body, &errRes)
			if errRes.Error == "reauth_required" {
				m.logger.Warn("downstream requires user re-authorization (reauth_required)", "server", server.Name)
				return "", ErrReauthRequired
			}
			return "", fmt.Errorf("console token delivery unauthorized: %s", string(body))
		}

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("console token delivery returned HTTP %d: %s", resp.StatusCode, string(body))
		}

		var tokenRes struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}
		if err := json.Unmarshal(body, &tokenRes); err != nil {
			return "", err
		}

		expiresIn := tokenRes.ExpiresIn
		if expiresIn <= 0 {
			expiresIn = 3600
		}

		m.tokenMu.Lock()
		m.tokenCache[server.ID] = cachedToken{
			accessToken: tokenRes.AccessToken,
			expiresAt:   time.Now().Add(time.Duration(expiresIn) * time.Second),
		}
		m.tokenMu.Unlock()

		m.logger.Info("received short-lived access token from control plane", "server", server.Name, "expires_in", expiresIn)
		return tokenRes.AccessToken, nil
	}

	return "", nil
}
