package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
)

// Client represents an OAuth 2.1 client registration.
type Client struct {
	ID                string   `json:"id"`
	ClientID          string   `json:"client_id"`
	ClientSecret      string   `json:"client_secret,omitempty"` // For confidential clients
	ClientType        string   `json:"client_type"`             // "CONFIDENTIAL" or "PUBLIC"
	TenantID          string   `json:"tenant_id"`
	RedirectURIs      []string `json:"redirect_uris"`
	AllowedGrantTypes []string `json:"allowed_grant_types"`
	AllowedScopes     []string `json:"allowed_scopes"`
}

type authCodeData struct {
	Code                string
	ClientID            string
	TenantID            string
	RedirectURI         string
	CodeChallenge       string
	CodeChallengeMethod string
	Scopes              []string
	ExpiresAt           time.Time
}

// Server coordinates OAuth 2.1 authorization and token endpoints.
type Server struct {
	mu         sync.RWMutex
	clients    map[string]*Client // key: client_id
	authCodes  map[string]*authCodeData
	keyManager *keys.Manager
	issuer     string
	audience   string
}

// NewServer creates a new OAuth 2.1 authorization server.
func NewServer(km *keys.Manager, issuer, audience string) *Server {
	return &Server{
		clients:    make(map[string]*Client),
		authCodes:  make(map[string]*authCodeData),
		keyManager: km,
		issuer:     issuer,
		audience:   audience,
	}
}

// RegisterClient adds a client registration to the OAuth server.
func (s *Server) RegisterClient(c *Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[c.ClientID] = c
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
	q := r.URL.Query()
	responseType := q.Get("response_type")
	clientID := q.Get("client_id")
	redirectURI := q.Get("redirect_uri")
	state := q.Get("state")
	codeChallenge := q.Get("code_challenge")
	codeChallengeMethod := q.Get("code_challenge_method")
	scope := q.Get("scope")

	if responseType != "code" {
		http.Error(w, "unsupported response_type: must be 'code'", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	client, ok := s.clients[clientID]
	s.mu.RUnlock()
	if !ok {
		http.Error(w, "unknown client_id", http.StatusUnauthorized)
		return
	}

	// Validate redirect URI
	if !s.validateRedirectURI(client, redirectURI) {
		http.Error(w, ErrInvalidRedirectURI.Error(), http.StatusBadRequest)
		return
	}

	// Enforce PKCE S256 for public clients (recommended for all clients in OAuth 2.1)
	if client.ClientType == "PUBLIC" || codeChallenge != "" {
		if codeChallenge == "" || codeChallengeMethod != "S256" {
			http.Error(w, "PKCE code_challenge required with code_challenge_method=S256", http.StatusBadRequest)
			return
		}
	}

	// Issue one-time authorization code (valid for 5 minutes)
	codeBytes := make([]byte, 24)
	_, _ = rand.Read(codeBytes)
	code := hex.EncodeToString(codeBytes)

	s.mu.Lock()
	s.authCodes[code] = &authCodeData{
		Code:                code,
		ClientID:            client.ClientID,
		TenantID:            client.TenantID,
		RedirectURI:         redirectURI,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		Scopes:              strings.Fields(scope),
		ExpiresAt:           time.Now().Add(5 * time.Minute),
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

	if err := r.ParseForm(); err != nil {
		s.writeOAuthError(w, "invalid_request", "failed parsing form body", http.StatusBadRequest)
		return
	}

	grantType := r.FormValue("grant_type")
	clientID, clientSecret, hasBasic := r.BasicAuth()
	if !hasBasic {
		clientID = r.FormValue("client_id")
		clientSecret = r.FormValue("client_secret")
	}

	switch grantType {
	case "client_credentials":
		s.handleClientCredentials(w, clientID, clientSecret, r.FormValue("scope"))
	case "authorization_code":
		s.handleAuthorizationCode(w, clientID, r.FormValue("code"), r.FormValue("redirect_uri"), r.FormValue("code_verifier"))
	default:
		s.writeOAuthError(w, "unsupported_grant_type", fmt.Sprintf("grant_type %q is not supported", grantType), http.StatusBadRequest)
	}
}

func (s *Server) handleClientCredentials(w http.ResponseWriter, clientID, secret, requestedScope string) {
	s.mu.RLock()
	client, ok := s.clients[clientID]
	s.mu.RUnlock()

	if !ok || client.ClientType != "CONFIDENTIAL" {
		s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
		return
	}

	// Constant-time comparison for secret
	if subtle.ConstantTimeCompare([]byte(client.ClientSecret), []byte(secret)) != 1 {
		s.writeOAuthError(w, "invalid_client", "client credentials invalid", http.StatusUnauthorized)
		return
	}

	// Determine scopes
	scopes := client.AllowedScopes
	if requestedScope != "" {
		reqList := strings.Fields(requestedScope)
		for _, s := range reqList {
			if !contains(client.AllowedScopes, s) {
				s.writeOAuthError(w, "invalid_scope", fmt.Sprintf("scope %q exceeds client permissions", s), http.StatusBadRequest)
				return
			}
		}
		scopes = reqList
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

func (s *Server) handleAuthorizationCode(w http.ResponseWriter, clientID, code, redirectURI, codeVerifier string) {
	s.mu.Lock()
	authData, ok := s.authCodes[code]
	if ok {
		delete(s.authCodes, code) // Single-use consumption
	}
	s.mu.Unlock()

	if !ok || time.Now().After(authData.ExpiresAt) {
		s.writeOAuthError(w, "invalid_grant", "authorization code invalid or expired", http.StatusBadRequest)
		return
	}

	if clientID != "" && authData.ClientID != clientID {
		s.writeOAuthError(w, "invalid_grant", "client_id mismatch", http.StatusBadRequest)
		return
	}

	if authData.RedirectURI != "" && authData.RedirectURI != redirectURI {
		s.writeOAuthError(w, "invalid_grant", "redirect_uri mismatch", http.StatusBadRequest)
		return
	}

	// Enforce PKCE S256 verification
	if authData.CodeChallenge != "" {
		if codeVerifier == "" {
			s.writeOAuthError(w, "invalid_request", "code_verifier required for PKCE", http.StatusBadRequest)
			return
		}
		hash := sha256.Sum256([]byte(codeVerifier))
		computedChallenge := base64.RawURLEncoding.EncodeToString(hash[:])
		if subtle.ConstantTimeCompare([]byte(authData.CodeChallenge), []byte(computedChallenge)) != 1 {
			s.writeOAuthError(w, "invalid_grant", "code_verifier does not match code_challenge", http.StatusBadRequest)
			return
		}
	}

	tokenStr, expiresIn, err := s.issueToken(authData.ClientID, authData.TenantID, authData.Scopes, []string{"user"})
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

func (s *Server) issueToken(subject, tenantID string, scopes, roles []string) (string, int, error) {
	key, err := s.keyManager.GetActiveKey()
	if err != nil {
		return "", 0, err
	}

	now := time.Now()
	expiresIn := 3600 // 1 hour
	exp := now.Add(time.Duration(expiresIn) * time.Second)

	jtiBytes := make([]byte, 16)
	_, _ = rand.Read(jtiBytes)

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
