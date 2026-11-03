package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/token/jwt"

	"AIGateway/internal/config"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/tokens"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

func newTestSQLStore(t *testing.T) (*SQLStore, func()) {
	t.Helper()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := migrations.MigrateUp(context.Background(), db); err != nil {
		_ = db.Close()
		t.Fatalf("apply migrations: %v", err)
	}
	if err := storage.NewSQLTenantRepository(db).CreateTenant(context.Background(), &tenants.Tenant{
		ID: "tenant-1", Name: "Test Tenant", Slug: "test-tenant",
	}); err != nil {
		_ = db.Close()
		t.Fatalf("create test tenant: %v", err)
	}
	hasherConfig := &fosite.Config{HashCost: 4}
	store, err := NewSQLStore(db, hasherConfig.GetSecretsHasher(context.Background()))
	if err != nil {
		_ = db.Close()
		t.Fatalf("create SQL store: %v", err)
	}
	return store, func() { _ = db.Close() }
}

func TestSQLStorePersistsHashedOAuthClient(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	const secret = "a-confidential-secret-with-enough-entropy"
	client := &Client{
		ID:                "record-1",
		ClientID:          "service-1",
		ClientSecret:      secret,
		ClientType:        "CONFIDENTIAL",
		TenantID:          "tenant-1",
		AllowedGrantTypes: []string{"client_credentials"},
		AllowedScopes:     []string{"mcp:read"},
	}
	if err := store.RegisterClient(context.Background(), client); err != nil {
		t.Fatalf("persist client: %v", err)
	}

	var storedHash string
	if err := store.db.QueryRow("SELECT client_secret_hash FROM oauth_clients WHERE client_id = $1", client.ClientID).Scan(&storedHash); err != nil {
		t.Fatalf("load persisted secret hash: %v", err)
	}
	if storedHash == secret || !strings.HasPrefix(storedHash, "$2") {
		t.Fatalf("persisted secret is not a bcrypt hash: %q", storedHash)
	}
	loaded, err := store.GetClient(context.Background(), client.ClientID)
	if err != nil {
		t.Fatalf("load client registration: %v", err)
	}
	if loaded.GetID() != client.ClientID || loaded.IsPublic() {
		t.Fatalf("loaded client identity/type incorrect: %#v", loaded)
	}
	if err := (&fosite.BCrypt{Config: &fosite.Config{HashCost: 4}}).Compare(context.Background(), loaded.GetHashedSecret(), []byte(secret)); err != nil {
		t.Fatalf("stored client secret hash does not verify: %v", err)
	}
	if _, err := store.GetClient(context.Background(), "missing"); err != fosite.ErrNotFound {
		t.Fatalf("missing client error = %v, want fosite.ErrNotFound", err)
	}
}

func TestSQLStorePersistsAndConsumesAuthorizationCode(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	if err := store.RegisterClient(context.Background(), &Client{
		ID:                "record-1",
		ClientID:          "public-app",
		ClientType:        "PUBLIC",
		TenantID:          "tenant-1",
		RedirectURIs:      []string{"https://app.example/callback"},
		AllowedGrantTypes: []string{"authorization_code"},
		AllowedScopes:     []string{"mcp:read"},
	}); err != nil {
		t.Fatalf("persist public client: %v", err)
	}
	client, err := store.GetClient(context.Background(), "public-app")
	if err != nil {
		t.Fatalf("load public client: %v", err)
	}
	session := &oauth2.JWTSession{
		JWTClaims: &jwt.JWTClaims{
			Subject: "user-1",
			Extra:   map[string]interface{}{"tenant_id": "tenant-1"},
		},
	}
	session.SetSubject("user-1")
	session.SetExpiresAt(fosite.AuthorizeCode, time.Now().Add(time.Minute))
	request := fosite.NewAuthorizeRequest()
	request.ID = "request-1"
	request.Client = client
	request.RequestedAt = time.Now().UTC()
	request.SetRequestedScopes(fosite.Arguments{"mcp:read"})
	request.GrantScope("mcp:read")
	request.Form.Set("redirect_uri", "https://app.example/callback")
	request.ResponseTypes = fosite.Arguments{"code"}
	request.RedirectURI, _ = url.Parse("https://app.example/callback")
	request.State = "random-state"
	request.SetSession(session)

	if err := store.CreateAuthorizeCodeSession(context.Background(), "code-signature", request); err != nil {
		t.Fatalf("persist authorization code: %v", err)
	}
	restartedStore, err := NewSQLStore(store.db, store.hasher)
	if err != nil {
		t.Fatalf("reopen SQL store: %v", err)
	}
	loaded, err := restartedStore.GetAuthorizeCodeSession(context.Background(), "code-signature", nil)
	if err != nil {
		t.Fatalf("load authorization code: %v", err)
	}
	loadedAuthorize, ok := loaded.(fosite.AuthorizeRequester)
	if !ok {
		t.Fatalf("loaded request type = %T, want AuthorizeRequester", loaded)
	}
	if loadedAuthorize.GetClient().GetID() != "public-app" || loadedAuthorize.GetSession().GetSubject() != "user-1" {
		t.Fatalf("loaded authorization request lost client or subject")
	}
	claims := loadedAuthorize.GetSession().(*oauth2.JWTSession).GetJWTClaims().ToMapClaims()
	if claims["tenant_id"] != "tenant-1" {
		t.Fatalf("loaded session lost tenant claim: %v", claims)
	}

	if err := restartedStore.InvalidateAuthorizeCodeSession(context.Background(), "code-signature"); err != nil {
		t.Fatalf("invalidate authorization code: %v", err)
	}
	loaded, err = store.GetAuthorizeCodeSession(context.Background(), "code-signature", nil)
	if err != fosite.ErrInvalidatedAuthorizeCode || loaded == nil {
		t.Fatalf("replayed code returned (%T, %v), want request and ErrInvalidatedAuthorizeCode", loaded, err)
	}
}

func TestSQLStoreRevokesAccessTokensDurably(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	clientRegistration := &Client{
		ID: "revoke-record", ClientID: "revoke-client", ClientType: "CONFIDENTIAL",
		ClientSecret: "long-enough-confidential-client-secret-value", TenantID: "tenant-1",
		AllowedGrantTypes: []string{"client_credentials"}, AllowedScopes: []string{"mcp:read"},
	}
	if err := store.RegisterClient(context.Background(), clientRegistration); err != nil {
		t.Fatalf("register client: %v", err)
	}
	client, err := store.GetClient(context.Background(), clientRegistration.ClientID)
	if err != nil {
		t.Fatalf("load client: %v", err)
	}
	expiresAt := time.Now().Add(time.Hour).UTC()
	const tokenID = "stable-token-jti"
	session := &oauth2.JWTSession{
		JWTClaims: &jwt.JWTClaims{
			Subject: "revoke-client", Issuer: "https://issuer.example",
			Audience: []string{"gateway-api"}, JTI: tokenID, IssuedAt: time.Now().UTC(),
			ExpiresAt: expiresAt, Extra: map[string]interface{}{
				"tenant_id": "tenant-1", "roles": []string{"client"},
			},
		},
	}
	session.SetSubject(client.GetID())
	session.SetExpiresAt(fosite.AccessToken, expiresAt)
	request := &fosite.Request{
		ID: "revoke-request", RequestedAt: time.Now().UTC(), Client: client,
		GrantedScope: fosite.Arguments{"mcp:read"}, RequestedScope: fosite.Arguments{"mcp:read"},
		Session: session,
	}
	if err := store.CreateAccessTokenSession(context.Background(), "access-signature", request); err != nil {
		t.Fatalf("persist access token session: %v", err)
	}
	if err := store.RevokeAccessToken(context.Background(), request.ID); err != nil {
		t.Fatalf("revoke access token: %v", err)
	}
	revocations, err := tokens.NewSQLRevocationStore(store.db)
	if err != nil {
		t.Fatalf("create revocation store: %v", err)
	}
	revoked, err := revocations.CheckRevoked(context.Background(), tokenID)
	if err != nil || !revoked {
		t.Fatalf("revocation lookup = (%t, %v), want true and no error", revoked, err)
	}
	var invalidated bool
	if err := store.db.QueryRowContext(context.Background(), `
		SELECT invalidated FROM oauth_sessions WHERE token_type = $1 AND signature = $2`,
		fositeAccessToken, "access-signature",
	).Scan(&invalidated); err != nil {
		t.Fatalf("read invalidated access token: %v", err)
	}
	if !invalidated {
		t.Fatal("access token session was not invalidated")
	}
}

type allowFositeAuthorization struct{}

func (allowFositeAuthorization) Authorize(_ context.Context, _ *http.Request, _ *Client, scopes []string) (AuthorizationDecision, error) {
	return AuthorizationDecision{Subject: "user-1", Scopes: append([]string(nil), scopes...)}, nil
}

func TestFositeServerAuthorizationCodeWithPKCEIssuesVerifiableJWT(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	if err := store.RegisterClient(context.Background(), &Client{
		ID:                "record-1",
		ClientID:          "web-app",
		ClientType:        "PUBLIC",
		TenantID:          "tenant-1",
		RedirectURIs:      []string{"https://app.example/callback"},
		AllowedGrantTypes: []string{"authorization_code"},
		AllowedScopes:     []string{"mcp:read"},
	}); err != nil {
		t.Fatalf("persist client: %v", err)
	}
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}
	server, err := NewFositeServer(store, keyManager, "https://issuer.example", "gateway-api", []byte(strings.Repeat("k", 32)))
	if err != nil {
		t.Fatalf("create Fosite server: %v", err)
	}
	server.SetAuthorizationService(allowFositeAuthorization{})

	verifier := strings.Repeat("v", 43)
	challengeHash := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {"web-app"},
		"redirect_uri":          {"https://app.example/callback"},
		"state":                 {"state-value-long-enough"},
		"scope":                 {"mcp:read"},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challengeHash[:])},
		"code_challenge_method": {"S256"},
	}
	authorizeRequest := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+query.Encode(), nil)
	authorizeResponse := httptest.NewRecorder()
	server.HandleAuthorize(authorizeResponse, authorizeRequest)
	if authorizeResponse.Code != http.StatusSeeOther {
		t.Fatalf("authorize status = %d, want %d: %s", authorizeResponse.Code, http.StatusSeeOther, authorizeResponse.Body.String())
	}
	callback, err := url.Parse(authorizeResponse.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse authorization callback: %v", err)
	}
	code := callback.Query().Get("code")
	if code == "" || callback.Query().Get("state") != "state-value-long-enough" {
		t.Fatalf("authorization response missing code or state: %s", callback)
	}

	restartedStore, err := NewSQLStore(store.db, store.hasher)
	if err != nil {
		t.Fatalf("reopen SQL store: %v", err)
	}
	server, err = NewFositeServer(restartedStore, keyManager, "https://issuer.example", "gateway-api", []byte(strings.Repeat("k", 32)))
	if err != nil {
		t.Fatalf("recreate OAuth provider: %v", err)
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {"web-app"},
		"code":          {code},
		"redirect_uri":  {"https://app.example/callback"},
		"code_verifier": {verifier},
	}
	tokenRequest := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	tokenRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenResponse := httptest.NewRecorder()
	server.HandleToken(tokenResponse, tokenRequest)
	if tokenResponse.Code != http.StatusOK {
		t.Fatalf("token status = %d, want %d: %s", tokenResponse.Code, http.StatusOK, tokenResponse.Body.String())
	}
	var response TokenResponse
	if err := json.Unmarshal(tokenResponse.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	tokenVerifier := tokens.NewVerifier(keyManager, tokens.NewRevocationManager(), "https://issuer.example", "gateway-api")
	claims, err := tokenVerifier.Verify(response.AccessToken)
	if err != nil {
		t.Fatalf("verify Fosite-issued access token: %v", err)
	}
	if claims.Subject != "user-1" || claims.TenantID != "tenant-1" || len(claims.Scopes) != 1 || claims.Scopes[0] != "mcp:read" {
		t.Fatalf("issued token claims do not preserve authorization: %+v", claims)
	}
	if tokenResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("token response missing Cache-Control: no-store")
	}
}

func TestFositeServerClientCredentialsIssuesTenantScopedJWT(t *testing.T) {
	store, closeDB := newTestSQLStore(t)
	defer closeDB()
	const secret = "client-secret-that-is-long-enough-to-be-secure"
	if err := store.RegisterClient(context.Background(), &Client{
		ID:                "record-2",
		ClientID:          "machine-client",
		ClientSecret:      secret,
		ClientType:        "CONFIDENTIAL",
		TenantID:          "tenant-1",
		AllowedGrantTypes: []string{"client_credentials"},
		AllowedScopes:     []string{"mcp:read"},
	}); err != nil {
		t.Fatalf("persist client: %v", err)
	}
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}
	server, err := NewFositeServer(store, keyManager, "https://issuer.example", "gateway-api", []byte(strings.Repeat("k", 32)))
	if err != nil {
		t.Fatalf("create Fosite server: %v", err)
	}
	form := url.Values{
		"grant_type": {"client_credentials"},
		"scope":      {"mcp:read"},
	}
	request := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth("machine-client", secret)
	response := httptest.NewRecorder()
	server.HandleToken(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("token status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var tokenResponse TokenResponse
	if err := json.Unmarshal(response.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	claims, err := tokens.NewVerifier(keyManager, tokens.NewRevocationManager(), "https://issuer.example", "gateway-api").Verify(tokenResponse.AccessToken)
	if err != nil {
		t.Fatalf("verify client credentials token: %v", err)
	}
	if claims.Subject != "machine-client" || claims.TenantID != "tenant-1" || len(claims.Scopes) != 1 || claims.Scopes[0] != "mcp:read" {
		t.Fatalf("client credentials claims are not tenant/scope bound: %+v", claims)
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "client" {
		t.Fatalf("client credentials roles = %v, want [client]", claims.Roles)
	}

	revocationStore, err := tokens.NewSQLRevocationStore(store.db)
	if err != nil {
		t.Fatalf("create SQL revocation store: %v", err)
	}
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://issuer.example", "gateway-api")
	revokeForm := url.Values{"token": {tokenResponse.AccessToken}, "token_type_hint": {"access_token"}}
	revokeRequest := httptest.NewRequest(http.MethodPost, "/oauth/revoke", strings.NewReader(revokeForm.Encode()))
	revokeRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	revokeRequest.SetBasicAuth("machine-client", secret)
	revokeResponse := httptest.NewRecorder()
	server.HandleRevoke(revokeResponse, revokeRequest)
	if revokeResponse.Code != http.StatusOK {
		t.Fatalf("revocation status = %d, want %d: %s", revokeResponse.Code, http.StatusOK, revokeResponse.Body.String())
	}
	if _, err := verifier.VerifyContext(context.Background(), tokenResponse.AccessToken); !errors.Is(err, tokens.ErrTokenRevoked) {
		t.Fatalf("revoked access token verification error = %v, want ErrTokenRevoked", err)
	}

	form.Set("scope", "mcp:admin")
	request = httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth("machine-client", secret)
	response = httptest.NewRecorder()
	server.HandleToken(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("out-of-policy scope status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}
