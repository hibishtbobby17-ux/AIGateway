package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/tokens"
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

// Client represents an OAuth 2.1 client registration.
type Client struct {
	ID                string   `json:"id"`
	ClientID          string   `json:"client_id"`
	ClientSecret      string   `json:"-"`           // Accepted only at registration; the server stores its hash.
	ClientType        string   `json:"client_type"` // "CONFIDENTIAL" or "PUBLIC"
	TenantID          string   `json:"tenant_id"`
	RedirectURIs      []string `json:"redirect_uris"`
	AllowedGrantTypes []string `json:"allowed_grant_types"`
	AllowedScopes     []string `json:"allowed_scopes"`
}

// AuthorizationDecision is the result of authenticating a user and obtaining
// their consent for an authorization request.
type AuthorizationDecision struct {
	Subject string
	Scopes  []string
}

// AuthorizationService authenticates the resource owner and returns the
// scopes they approved. Implementations must not trust identity data supplied
// by the OAuth request.
type AuthorizationService interface {
	Authorize(context.Context, *http.Request, *Client, []string) (AuthorizationDecision, error)
}

type registeredClient struct {
	client     *Client
	secretHash [sha256.Size]byte
}

type authCodeData struct {
	ClientID      string
	TenantID      string
	Subject       string
	RedirectURI   string
	CodeChallenge string
	Scopes        []string
	ExpiresAt     time.Time
}

// Server coordinates OAuth 2.1 authorization and token endpoints.
type Server struct {
	mu                   sync.RWMutex
	clients              map[string]*registeredClient // key: client_id
	authCodes            map[[sha256.Size]byte]*authCodeData
	authorizationService AuthorizationService
	keyManager           *keys.Manager
	issuer               string
	audience             string
}

// NewServer creates a new OAuth 2.1 authorization server.
func NewServer(km *keys.Manager, issuer, audience string) *Server {
	return &Server{
		clients:    make(map[string]*registeredClient),
		authCodes:  make(map[[sha256.Size]byte]*authCodeData),
		keyManager: km,
		issuer:     issuer,
		audience:   audience,
	}
}

// SetAuthorizationService configures resource-owner authentication and consent.
func (s *Server) SetAuthorizationService(service AuthorizationService) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authorizationService = service
}

// RegisterClient validates and stores a client registration. Confidential
// client secrets are hashed before being retained.
func (s *Server) RegisterClient(c *Client) error {
	if c == nil {
		return fmt.Errorf("oauth client cannot be nil")
	}
	if c.ID == "" || c.ClientID == "" || c.TenantID == "" {
		return fmt.Errorf("oauth client id, client_id, and tenant_id are required")
	}
	if c.ClientType != "PUBLIC" && c.ClientType != "CONFIDENTIAL" {
		return fmt.Errorf("oauth client_type must be PUBLIC or CONFIDENTIAL")
	}
	if len(c.AllowedGrantTypes) == 0 {
		return fmt.Errorf("oauth client must allow at least one grant type")
	}
	for _, grant := range c.AllowedGrantTypes {
		if grant != "authorization_code" && grant != "client_credentials" {
			return fmt.Errorf("unsupported allowed grant type %q", grant)
		}
		if grant == "client_credentials" && c.ClientType != "CONFIDENTIAL" {
			return fmt.Errorf("client_credentials is only permitted for confidential clients")
		}
	}
	if contains(c.AllowedGrantTypes, "authorization_code") && len(c.RedirectURIs) == 0 {
		return fmt.Errorf("authorization_code clients must register at least one redirect URI")
	}
	for _, redirectURI := range c.RedirectURIs {
		if !validRedirectURI(redirectURI) {
			return fmt.Errorf("invalid registered redirect URI %q", redirectURI)
		}
	}
	if c.ClientType == "CONFIDENTIAL" && len(c.ClientSecret) < 32 {
		return fmt.Errorf("confidential client secret must be at least 32 characters")
	}
	if c.ClientType == "PUBLIC" && c.ClientSecret != "" {
		return fmt.Errorf("public clients must not have a client secret")
	}
	for _, scope := range c.AllowedScopes {
		if !validScope(scope) {
			return fmt.Errorf("invalid registered scope %q", scope)
		}
	}

	clientCopy := *c
	clientCopy.RedirectURIs = append([]string(nil), c.RedirectURIs...)
	clientCopy.AllowedGrantTypes = append([]string(nil), c.AllowedGrantTypes...)
	clientCopy.AllowedScopes = append([]string(nil), c.AllowedScopes...)
	secretHash := sha256.Sum256([]byte(c.ClientSecret))

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.clients[c.ClientID]; exists {
		return ErrClientAlreadyExists
	}
	s.clients[c.ClientID] = &registeredClient{
		client:     &clientCopy,
		secretHash: secretHash,
	}
	return nil
}

// HandleJWKS serves the /.well-known/jwks.json endpoint.
func (s *Server) HandleJWKS(w http.ResponseWriter, r *http.Request) {
	jwks := s.keyManager.GetJWKS()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_ = json.NewEncoder(w).Encode(jwks)
}

// HandleAuthorize handles the /oauth/authorize endpoint.
func (s *Server) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method must be GET", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	responseType := q.Get("response_type")
	clientID := q.Get("client_id")
	redirectURI := q.Get("redirect_uri")
	state := q.Get("state")
	codeChallenge := q.Get("code_challenge")
	codeChallengeMethod := q.Get("code_challenge_method")
	scope := q.Get("scope")
	if state == "" {
		http.Error(w, "state is required", http.StatusBadRequest)
		return
	}

	if responseType != "code" {
		http.Error(w, "unsupported response_type: must be 'code'", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	registration, ok := s.clients[clientID]
	s.mu.RUnlock()
	if !ok {
		http.Error(w, "unknown client_id", http.StatusUnauthorized)
		return
	}
	client := registration.client
	if !contains(client.AllowedGrantTypes, "authorization_code") {
		http.Error(w, "client is not permitted to use authorization_code", http.StatusForbidden)
		return
	}

	// Validate redirect URI
	if !s.validateRedirectURI(client, redirectURI) {
		http.Error(w, ErrInvalidRedirectURI.Error(), http.StatusBadRequest)
		return
	}

	if !validPKCEChallenge(codeChallenge, codeChallengeMethod) {
		http.Error(w, "PKCE code_challenge with code_challenge_method=S256 is required", http.StatusBadRequest)
		return
	}

	requestedScopes, ok := requestedScopes(scope, client.AllowedScopes)
	if !ok {
		http.Error(w, "requested scope exceeds client permissions or is invalid", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	authorizationService := s.authorizationService
	s.mu.RUnlock()
	if authorizationService == nil {
		http.Error(w, "authorization service is not configured", http.StatusServiceUnavailable)
		return
	}
	decision, err := authorizationService.Authorize(r.Context(), r, cloneClient(client), requestedScopes)
	if err != nil || decision.Subject == "" || !scopesSubset(decision.Scopes, requestedScopes) {
		http.Error(w, ErrAuthorizationDenied.Error(), http.StatusForbidden)
		return
	}

	codeBytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, codeBytes); err != nil {
		http.Error(w, "failed generating authorization code", http.StatusInternalServerError)
		return
	}
	code := base64.RawURLEncoding.EncodeToString(codeBytes)
	codeHash := sha256.Sum256([]byte(code))

	s.mu.Lock()
	s.authCodes[codeHash] = &authCodeData{
		ClientID:      client.ClientID,
		TenantID:      client.TenantID,
		Subject:       decision.Subject,
		RedirectURI:   redirectURI,
		CodeChallenge: codeChallenge,
		Scopes:        append([]string(nil), decision.Scopes...),
		ExpiresAt:     time.Now().Add(5 * time.Minute),
	}
	s.mu.Unlock()

	// Redirect back with authorization code
	redirectParsed, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, "invalid redirect_uri format", http.StatusBadRequest)
		return
	}
	values := redirectParsed.Query()
	values.Set("code", code)
	if state != "" {
		values.Set("state", state)
	}
	redirectParsed.RawQuery = values.Encode()

	http.Redirect(w, r, redirectParsed.String(), http.StatusFound)
}

// TokenResponse represents a standard OAuth 2.0 token response.
type TokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Scope       string `json:"scope,omitempty"`
}

// HandleToken processes /oauth/token requests.
func (s *Server) HandleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method must be POST", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")

	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	if err := r.ParseForm(); err != nil {
		s.writeOAuthError(w, "invalid_request", "failed parsing form body", http.StatusBadRequest)
		return
	}

	grantType := r.FormValue("grant_type")
	clientID, clientSecret, hasBasic := r.BasicAuth()
	if hasBasic && (r.FormValue("client_id") != "" || r.FormValue("client_secret") != "") {
		s.writeOAuthError(w, "invalid_request", "client credentials must use exactly one authentication method", http.StatusBadRequest)
		return
	}
	if !hasBasic {
		clientID = r.FormValue("client_id")
		clientSecret = r.FormValue("client_secret")
	}

	switch grantType {
	case "client_credentials":
		s.handleClientCredentials(w, clientID, clientSecret, r.FormValue("scope"), hasBasic)
	case "authorization_code":
		s.handleAuthorizationCode(w, clientID, clientSecret, hasBasic, r.FormValue("code"), r.FormValue("redirect_uri"), r.FormValue("code_verifier"))
	default:
		s.writeOAuthError(w, "unsupported_grant_type", fmt.Sprintf("grant_type %q is not supported", grantType), http.StatusBadRequest)
	}
}

func (s *Server) handleClientCredentials(w http.ResponseWriter, clientID, secret, requestedScope string, hasBasic bool) {
	s.mu.RLock()
	registration, ok := s.clients[clientID]
	s.mu.RUnlock()

	if !ok || registration.client.ClientType != "CONFIDENTIAL" ||
		!contains(registration.client.AllowedGrantTypes, "client_credentials") {
		s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
		return
	}

	if !hasBasic && secret == "" {
		s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
		return
	}
	secretHash := sha256.Sum256([]byte(secret))
	if subtle.ConstantTimeCompare(registration.secretHash[:], secretHash[:]) != 1 {
		s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
		return
	}
	client := registration.client

	// Determine scopes
	scopes, valid := requestedScopes(requestedScope, client.AllowedScopes)
	if !valid {
		s.writeOAuthError(w, "invalid_scope", "requested scope exceeds client permissions or is invalid", http.StatusBadRequest)
		return
	}

	tokenStr, expiresIn, err := s.issueToken(client.ClientID, client.TenantID, scopes, []string{"client"})
	if err != nil {
		s.writeOAuthError(w, "server_error", "failed generating token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TokenResponse{
		AccessToken: tokenStr,
		TokenType:   "Bearer",
		ExpiresIn:   expiresIn,
		Scope:       strings.Join(scopes, " "),
	})
}

func (s *Server) handleAuthorizationCode(w http.ResponseWriter, clientID, clientSecret string, hasBasic bool, code, redirectURI, codeVerifier string) {
	if clientID == "" || code == "" {
		s.writeOAuthError(w, "invalid_request", "client_id and code are required", http.StatusBadRequest)
		return
	}
	if !validPKCEVerifier(codeVerifier) {
		s.writeOAuthError(w, "invalid_request", "code_verifier must be 43-128 unreserved characters", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	registration, registered := s.clients[clientID]
	s.mu.RUnlock()
	if !registered || !contains(registration.client.AllowedGrantTypes, "authorization_code") {
		s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
		return
	}
	if registration.client.ClientType == "CONFIDENTIAL" {
		if !hasBasic || clientSecret == "" {
			s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
			return
		}
		secretHash := sha256.Sum256([]byte(clientSecret))
		if subtle.ConstantTimeCompare(registration.secretHash[:], secretHash[:]) != 1 {
			s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
			return
		}
	} else if hasBasic || clientSecret != "" {
		s.writeOAuthError(w, "invalid_client", "public clients must not authenticate with a secret", http.StatusUnauthorized)
		return
	}

	codeHash := sha256.Sum256([]byte(code))
	s.mu.Lock()
	authData, ok := s.authCodes[codeHash]
	if ok && authData.ClientID == clientID && authData.RedirectURI == redirectURI && time.Now().Before(authData.ExpiresAt) {
		delete(s.authCodes, codeHash)
	} else {
		ok = false
	}
	s.mu.Unlock()
	if !ok {
		s.writeOAuthError(w, "invalid_grant", "authorization code invalid, expired, or mismatched", http.StatusBadRequest)
		return
	}

	// Enforce PKCE S256 verification
	hash := sha256.Sum256([]byte(codeVerifier))
	computedChallenge := base64.RawURLEncoding.EncodeToString(hash[:])
	if subtle.ConstantTimeCompare([]byte(authData.CodeChallenge), []byte(computedChallenge)) != 1 {
		s.writeOAuthError(w, "invalid_grant", "code_verifier does not match code_challenge", http.StatusBadRequest)
		return
	}

	tokenStr, expiresIn, err := s.issueToken(authData.Subject, authData.TenantID, authData.Scopes, []string{"user"})
	if err != nil {
		s.writeOAuthError(w, "server_error", "failed generating token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TokenResponse{
		AccessToken: tokenStr,
		TokenType:   "Bearer",
		ExpiresIn:   expiresIn,
		Scope:       strings.Join(authData.Scopes, " "),
	})
}

func validPKCEChallenge(challenge, method string) bool {
	if method != "S256" || len(challenge) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(challenge)
	return err == nil && len(decoded) == sha256.Size
}

func validPKCEVerifier(verifier string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	for _, r := range verifier {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' ||
			r >= '0' && r <= '9' || strings.ContainsRune("-._~", r)) {
			return false
		}
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

func requestedScopes(raw string, allowed []string) ([]string, bool) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, true
	}
	scopes := strings.Fields(raw)
	seen := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		if !validScope(scope) || !contains(allowed, scope) {
			return nil, false
		}
		if _, exists := seen[scope]; exists {
			return nil, false
		}
		seen[scope] = struct{}{}
	}
	return scopes, true
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

func cloneClient(client *Client) *Client {
	cloned := *client
	cloned.RedirectURIs = append([]string(nil), client.RedirectURIs...)
	cloned.AllowedGrantTypes = append([]string(nil), client.AllowedGrantTypes...)
	cloned.AllowedScopes = append([]string(nil), client.AllowedScopes...)
	cloned.ClientSecret = ""
	return &cloned
}

func (s *Server) issueToken(subject, tenantID string, scopes, roles []string) (string, int, error) {
	if s.keyManager == nil {
		return "", 0, fmt.Errorf("signing key manager is not configured")
	}
	if s.issuer == "" || s.audience == "" || subject == "" || tenantID == "" {
		return "", 0, fmt.Errorf("issuer, audience, subject, and tenant are required to issue a token")
	}
	key, err := s.keyManager.GetActiveKey()
	if err != nil {
		return "", 0, err
	}

	now := time.Now()
	expiresIn := 3600 // 1 hour
	exp := now.Add(time.Duration(expiresIn) * time.Second)

	jtiBytes := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, jtiBytes); err != nil {
		return "", 0, fmt.Errorf("failed generating token identifier: %w", err)
	}

	claims := &tokens.Claims{
		Issuer:    s.issuer,
		Subject:   subject,
		Audience:  s.audience,
		TenantID:  tenantID,
		Scopes:    scopes,
		Roles:     roles,
		IssuedAt:  now.Unix(),
		ExpiresAt: exp.Unix(),
		TokenID:   hex.EncodeToString(jtiBytes),
	}

	tokenStr, err := tokens.Sign(claims, key)
	if err != nil {
		return "", 0, err
	}
	return tokenStr, expiresIn, nil
}

func (s *Server) validateRedirectURI(client *Client, redirectURI string) bool {
	if redirectURI == "" {
		return false
	}
	for _, uri := range client.RedirectURIs {
		if uri == redirectURI {
			return true
		}
	}
	return false
}

func (s *Server) writeOAuthError(w http.ResponseWriter, errCode, errDesc string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":             errCode,
		"error_description": errDesc,
	})
}

func contains(list []string, item string) bool {
	for _, s := range list {
		if s == item {
			return true
		}
	}
	return false
}
