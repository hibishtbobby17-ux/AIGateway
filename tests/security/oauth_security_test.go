package security_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/ory/fosite"

	"AIGateway/internal/config"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/oauth"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

type fixedConsentService struct {
	subject string
	scopes  []string
}

func (s fixedConsentService) Authorize(_ context.Context, _ *http.Request, _ *oauth.Client, requested []string) (oauth.AuthorizationDecision, error) {
	return oauth.AuthorizationDecision{
		Subject: s.subject,
		Scopes:  requested,
	}, nil
}

func TestSecurity_OAuthPKCEEnforcement(t *testing.T) {
	ctx := context.Background()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}
	defer db.Close()

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-sec", Name: "Tenant Sec", Slug: "tenant-sec"})

	hasherConfig := &fosite.Config{HashCost: 4}
	store, err := oauth.NewSQLStore(db, hasherConfig.GetSecretsHasher(ctx))
	if err != nil {
		t.Fatalf("sql store: %v", err)
	}

	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("key manager: %v", err)
	}

	globalSecret := []byte("thirty-two-bytes-minimum-secret-val-!")
	server, err := oauth.NewFositeServer(store, keyManager, "https://gateway.example.com", "ai-gateway", globalSecret)
	if err != nil {
		t.Fatalf("fosite server: %v", err)
	}

	server.SetAuthorizationService(fixedConsentService{
		subject: "user-alice",
		scopes:  []string{"tools:call"},
	})

	err = server.RegisterClient(ctx, &oauth.Client{
		ID:                "client-1",
		ClientID:          "public-cli",
		ClientType:        "PUBLIC",
		TenantID:          "tenant-sec",
		RedirectURIs:      []string{"https://app.example.com/callback"},
		AllowedGrantTypes: []string{"authorization_code"},
		AllowedScopes:     []string{"tools:call"},
	})
	if err != nil {
		t.Fatalf("register client: %v", err)
	}

	// 1. Plain code_challenge_method MUST BE REJECTED
	plainReq := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+url.Values{
		"response_type":         {"code"},
		"client_id":             {"public-cli"},
		"redirect_uri":          {"https://app.example.com/callback"},
		"scope":                 {"tools:call"},
		"code_challenge":        {"plain-verifier-string"},
		"code_challenge_method": {"plain"},
		"state":                 {"state-xyz"},
	}.Encode(), nil)
	rrPlain := httptest.NewRecorder()
	server.HandleAuthorize(rrPlain, plainReq)

	if !strings.Contains(rrPlain.Header().Get("Location"), "error=") && rrPlain.Code < 400 {
		t.Errorf("SECURITY VIOLATION: plain PKCE challenge method was not rejected! Location: %s", rrPlain.Header().Get("Location"))
	}

	// 2. Legitimate S256 PKCE Authorization Code Generation
	verifier := "db664b8c62c3e1e2d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7"
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])

	authReq := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+url.Values{
		"response_type":         {"code"},
		"client_id":             {"public-cli"},
		"redirect_uri":          {"https://app.example.com/callback"},
		"scope":                 {"tools:call"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {"state-valid"},
	}.Encode(), nil)
	rrAuth := httptest.NewRecorder()
	server.HandleAuthorize(rrAuth, authReq)

	loc := rrAuth.Header().Get("Location")
	parsedLoc, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("invalid redirect: %s", loc)
	}
	code := parsedLoc.Query().Get("code")
	if code == "" {
		t.Fatalf("expected authorization code, got none: %s", loc)
	}

	// 3. Attempt token exchange with WRONG code_verifier -> MUST BE DENIED
	wrongTokenReq := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {"public-cli"},
		"code":          {code},
		"redirect_uri":  {"https://app.example.com/callback"},
		"code_verifier": {"wrong-code-verifier-string-here-1234567890"},
	}.Encode()))
	wrongTokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rrWrong := httptest.NewRecorder()
	server.HandleToken(rrWrong, wrongTokenReq)

	if rrWrong.Code != http.StatusBadRequest {
		t.Errorf("SECURITY VIOLATION: wrong code_verifier returned status %d (expected 400)", rrWrong.Code)
	}

	// 4. Generate new authorization code for legitimate exchange
	authReq2 := httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+url.Values{
		"response_type":         {"code"},
		"client_id":             {"public-cli"},
		"redirect_uri":          {"https://app.example.com/callback"},
		"scope":                 {"tools:call"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {"state-valid-2"},
	}.Encode(), nil)
	rrAuth2 := httptest.NewRecorder()
	server.HandleAuthorize(rrAuth2, authReq2)

	loc2 := rrAuth2.Header().Get("Location")
	parsedLoc2, err := url.Parse(loc2)
	if err != nil {
		t.Fatalf("invalid redirect: %s", loc2)
	}
	code2 := parsedLoc2.Query().Get("code")

	// Token exchange with CORRECT code_verifier -> SUCCEEDS
	correctTokenReq := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {"public-cli"},
		"code":          {code2},
		"redirect_uri":  {"https://app.example.com/callback"},
		"code_verifier": {verifier},
	}.Encode()))
	correctTokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rrCorrect := httptest.NewRecorder()
	server.HandleToken(rrCorrect, correctTokenReq)

	if rrCorrect.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid code verifier, got %d: %s", rrCorrect.Code, rrCorrect.Body.String())
	}
	var tokenRes map[string]any
	_ = json.Unmarshal(rrCorrect.Body.Bytes(), &tokenRes)
	if tokenRes["access_token"] == "" {
		t.Errorf("expected access_token in response: %v", tokenRes)
	}

	// 5. Code Replay Attack -> MUST BE DENIED (single-use authorization code)
	replayTokenReq := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {"public-cli"},
		"code":          {code2},
		"redirect_uri":  {"https://app.example.com/callback"},
		"code_verifier": {verifier},
	}.Encode()))
	replayTokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rrReplay := httptest.NewRecorder()
	server.HandleToken(rrReplay, replayTokenReq)

	if rrReplay.Code != http.StatusBadRequest {
		t.Errorf("SECURITY VIOLATION: authorization code replay attack succeeded! Status: %d", rrReplay.Code)
	}
}

func TestSecurity_ClientSecretAuthentication(t *testing.T) {
	ctx := context.Background()
	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}
	defer db.Close()
	_ = migrations.MigrateUp(ctx, db)
	_ = storage.NewSQLTenantRepository(db).CreateTenant(ctx, &tenants.Tenant{ID: "t-secret", Name: "T", Slug: "t"})

	hasherConfig := &fosite.Config{HashCost: 4}
	store, _ := oauth.NewSQLStore(db, hasherConfig.GetSecretsHasher(ctx))
	keyManager, _ := keys.NewManager()
	globalSecret := []byte("thirty-two-bytes-minimum-secret-val-!")
	server, _ := oauth.NewFositeServer(store, keyManager, "https://gateway.example.com", "ai-gateway", globalSecret)

	const secret = "a-very-secret-password-that-is-at-least-32-chars-long"
	if err := server.RegisterClient(ctx, &oauth.Client{
		ID:                "conf-1",
		ClientID:          "backend-service",
		ClientSecret:      secret,
		ClientType:        "CONFIDENTIAL",
		TenantID:          "t-secret",
		AllowedGrantTypes: []string{"client_credentials"},
		AllowedScopes:     []string{"system:read"},
	}); err != nil {
		t.Fatalf("register client failed: %v", err)
	}

	// 1. Wrong secret -> MUST BE DENIED
	wrongReq := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(url.Values{
		"grant_type": {"client_credentials"},
		"scope":      {"system:read"},
	}.Encode()))
	wrongReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	wrongReq.SetBasicAuth("backend-service", "wrong-secret-password-that-is-also-32-chars-long!")
	rrWrong := httptest.NewRecorder()
	server.HandleToken(rrWrong, wrongReq)

	if rrWrong.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for wrong secret, got %d: %s", rrWrong.Code, rrWrong.Body.String())
	}

	// 2. Correct secret -> SUCCEEDS
	correctReq := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(url.Values{
		"grant_type": {"client_credentials"},
		"scope":      {"system:read"},
	}.Encode()))
	correctReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	correctReq.SetBasicAuth("backend-service", secret)
	rrCorrect := httptest.NewRecorder()
	server.HandleToken(rrCorrect, correctReq)

	if rrCorrect.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for correct client secret, got %d: %s", rrCorrect.Code, rrCorrect.Body.String())
	}
}
