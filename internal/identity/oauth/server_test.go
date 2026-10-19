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

	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/tokens"
)

type allowAuthorization struct{}

func (allowAuthorization) Authorize(_ context.Context, _ *http.Request, _ *Client, scopes []string) (AuthorizationDecision, error) {
	return AuthorizationDecision{Subject: "user-123", Scopes: append([]string(nil), scopes...)}, nil
}

func newTestServer(t *testing.T) (*Server, *tokens.Verifier) {
	t.Helper()
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("create key manager: %v", err)
	}
	server := NewServer(keyManager, "https://issuer.example", "gateway-api")
	verifier := tokens.NewVerifier(keyManager, nil, "https://issuer.example", "gateway-api")
	return server, verifier
}

func registerTestClient(t *testing.T, server *Server, client *Client) {
	t.Helper()
	if err := server.RegisterClient(client); err != nil {
		t.Fatalf("register client: %v", err)
	}
}

func publicClient() *Client {
	return &Client{
		ID:                "client-record-1",
		ClientID:          "web-client",
		ClientType:        "PUBLIC",
		TenantID:          "tenant-1",
		RedirectURIs:      []string{"https://app.example/callback"},
		AllowedGrantTypes: []string{"authorization_code"},
		AllowedScopes:     []string{"mcp:read", "agents:read"},
	}
}

func authorizationRequest(server *Server, clientID, verifier, scope string) *httptest.ResponseRecorder {
	challengeHash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeHash[:])
	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {clientID},
		"redirect_uri":          {"https://app.example/callback"},
		"state":                 {"opaque-state"},
		"scope":                 {scope},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	request := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+query.Encode(), nil)
	response := httptest.NewRecorder()
	server.HandleAuthorize(response, request)
	return response
}

func exchangeAuthorizationCode(server *Server, clientID, code, verifier string) *httptest.ResponseRecorder {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"code":          {code},
		"redirect_uri":  {"https://app.example/callback"},
		"code_verifier": {verifier},
	}
	request := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	server.HandleToken(response, request)
	return response
}

func authorizationCodeFromResponse(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	if response.Code != http.StatusFound {
		t.Fatalf("authorize status = %d, want %d; body: %s", response.Code, http.StatusFound, response.Body.String())
	}
	location, err := url.Parse(response.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse redirect location: %v", err)
	}
	if got := location.Query().Get("state"); got != "opaque-state" {
		t.Fatalf("redirect state = %q, want opaque-state", got)
	}
	code := location.Query().Get("code")
	if code == "" {
		t.Fatal("authorization code missing from redirect")
	}
	return code
}

func TestAuthorizationCodeRequiresAuthorizationService(t *testing.T) {
	server, _ := newTestServer(t)
	registerTestClient(t, server, publicClient())

	response := authorizationRequest(server, "web-client", strings.Repeat("v", 43), "mcp:read")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("authorize status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestAuthorizationCodeRequiresPKCEForConfidentialClients(t *testing.T) {
	server, _ := newTestServer(t)
	registerTestClient(t, server, &Client{
		ID:                "client-record-1",
		ClientID:          "confidential-web",
		ClientSecret:      strings.Repeat("s", 32),
		ClientType:        "CONFIDENTIAL",
		TenantID:          "tenant-1",
		RedirectURIs:      []string{"https://app.example/callback"},
		AllowedGrantTypes: []string{"authorization_code"},
		AllowedScopes:     []string{"mcp:read"},
	})
	server.SetAuthorizationService(allowAuthorization{})

	request := httptest.NewRequest(http.MethodGet,
		"/oauth/authorize?response_type=code&client_id=confidential-web&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&state=state",
		nil,
	)
	response := httptest.NewRecorder()
	server.HandleAuthorize(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("authorize status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestAuthorizationCodePKCEAndClientBinding(t *testing.T) {
	server, verifier := newTestServer(t)
	registerTestClient(t, server, publicClient())
	server.SetAuthorizationService(allowAuthorization{})

	codeVerifier := strings.Repeat("v", 43)
	code := authorizationCodeFromResponse(t, authorizationRequest(server, "web-client", codeVerifier, "mcp:read"))
	response := exchangeAuthorizationCode(server, "another-client", code, codeVerifier)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("wrong-client exchange status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	response = exchangeAuthorizationCode(server, "web-client", code, codeVerifier)
	if response.Code != http.StatusOK {
		t.Fatalf("valid exchange after wrong-client attempt status = %d, want %d", response.Code, http.StatusOK)
	}

	code = authorizationCodeFromResponse(t, authorizationRequest(server, "web-client", codeVerifier, "mcp:read"))
	response = exchangeAuthorizationCode(server, "web-client", code, strings.Repeat("x", 43))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("wrong-verifier exchange status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	code = authorizationCodeFromResponse(t, authorizationRequest(server, "web-client", codeVerifier, "mcp:read"))
	response = exchangeAuthorizationCode(server, "web-client", code, codeVerifier)
	if response.Code != http.StatusOK {
		t.Fatalf("valid exchange status = %d, want %d; body: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Pragma") != "no-cache" {
		t.Fatalf("token response cache headers = (%q, %q), want no-store/no-cache", response.Header().Get("Cache-Control"), response.Header().Get("Pragma"))
	}

	var tokenResponse TokenResponse
	if err := json.Unmarshal(response.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	claims, err := verifier.Verify(tokenResponse.AccessToken)
	if err != nil {
		t.Fatalf("verify issued access token: %v", err)
	}
	if claims.Subject != "user-123" || claims.TenantID != "tenant-1" {
		t.Fatalf("issued token identity = (%q, %q), want (user-123, tenant-1)", claims.Subject, claims.TenantID)
	}
	if len(claims.Scopes) != 1 || claims.Scopes[0] != "mcp:read" {
		t.Fatalf("issued scopes = %v, want [mcp:read]", claims.Scopes)
	}

	response = exchangeAuthorizationCode(server, "web-client", code, codeVerifier)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("replayed code status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestAuthorizationRejectsUnregisteredScope(t *testing.T) {
	server, _ := newTestServer(t)
	registerTestClient(t, server, publicClient())
	server.SetAuthorizationService(allowAuthorization{})

	response := authorizationRequest(server, "web-client", strings.Repeat("v", 43), "mcp:admin")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("authorize status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestClientCredentialsEnforcesRegisteredGrantAndScopes(t *testing.T) {
	server, verifier := newTestServer(t)
	const secret = "test-client-secret-with-sufficient-entropy-123"
	registerTestClient(t, server, &Client{
		ID:                "service-record-1",
		ClientID:          "service-client",
		ClientSecret:      secret,
		ClientType:        "CONFIDENTIAL",
		TenantID:          "tenant-2",
		AllowedGrantTypes: []string{"client_credentials"},
		AllowedScopes:     []string{"mcp:read"},
	})

	request := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader("grant_type=client_credentials&scope=mcp%3Aadmin"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth("service-client", secret)
	response := httptest.NewRecorder()
	server.HandleToken(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("excess-scope status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	request = httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader("grant_type=client_credentials&scope=mcp%3Aread"))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth("service-client", secret)
	response = httptest.NewRecorder()
	server.HandleToken(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("valid client_credentials status = %d, want %d; body: %s", response.Code, http.StatusOK, response.Body.String())
	}

	var tokenResponse TokenResponse
	if err := json.Unmarshal(response.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	claims, err := verifier.Verify(tokenResponse.AccessToken)
	if err != nil {
		t.Fatalf("verify issued token: %v", err)
	}
	if claims.Subject != "service-client" || claims.TenantID != "tenant-2" {
		t.Fatalf("issued token identity = (%q, %q), want (service-client, tenant-2)", claims.Subject, claims.TenantID)
	}
}

func TestRegisterClientValidatesAndProtectsSecret(t *testing.T) {
	server, _ := newTestServer(t)
	client := publicClient()
	client.ClientSecret = "must-not-be-accepted"
	if err := server.RegisterClient(client); err == nil {
		t.Fatal("RegisterClient accepted a secret for a public client")
	}

	client = &Client{
		ID:                "service-record-1",
		ClientID:          "service-client",
		ClientSecret:      strings.Repeat("s", 32),
		ClientType:        "CONFIDENTIAL",
		TenantID:          "tenant-1",
		AllowedGrantTypes: []string{"client_credentials"},
		AllowedScopes:     []string{"mcp:read"},
	}
	registerTestClient(t, server, client)
	if err := server.RegisterClient(client); !errors.Is(err, ErrClientAlreadyExists) {
		t.Fatalf("duplicate registration error = %v, want ErrClientAlreadyExists", err)
	}
	encoded, err := json.Marshal(client)
	if err != nil {
		t.Fatalf("marshal client registration: %v", err)
	}
	if strings.Contains(string(encoded), client.ClientSecret) {
		t.Fatal("client JSON exposed its secret")
	}
}
