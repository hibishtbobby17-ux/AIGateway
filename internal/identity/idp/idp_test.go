package idp_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"AIGateway/internal/config"
	"AIGateway/internal/identity/idp"
	"AIGateway/internal/identity/oauth"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

func TestBuiltInIdP_UserRegistrationAndAuthentication(t *testing.T) {
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-idp", Name: "IDP", Slug: "idp"})

	userRepo, err := idp.NewSQLUserRepository(db, 4) // low cost for fast test
	if err != nil {
		t.Fatalf("user repo: %v", err)
	}

	// 1. Password too short (< 8 chars)
	err = userRepo.CreateUser(ctx, &idp.User{
		TenantID: "tenant-idp",
		Username: "short",
	}, "short")
	if !errors.Is(err, idp.ErrPasswordTooShort) {
		t.Errorf("expected ErrPasswordTooShort, got: %v", err)
	}

	// 2. Successful user creation
	u := &idp.User{
		TenantID: "tenant-idp",
		Username: "john_doe",
		Email:    "john@example.com",
		Roles:    []string{"tool-consumer", "agent-operator"},
	}
	if err := userRepo.CreateUser(ctx, u, "super-secret-password-123"); err != nil {
		t.Fatalf("create user: %v", err)
	}

	// 3. Duplicate user in same tenant fails
	dupUser := &idp.User{
		TenantID: "tenant-idp",
		Username: "john_doe",
	}
	if err := userRepo.CreateUser(ctx, dupUser, "another-password-123"); !errors.Is(err, idp.ErrUserAlreadyExists) {
		t.Errorf("expected ErrUserAlreadyExists, got: %v", err)
	}

	// 4. Authenticate with correct password
	authenticated, err := userRepo.Authenticate(ctx, "tenant-idp", "john_doe", "super-secret-password-123")
	if err != nil {
		t.Fatalf("authenticate valid: %v", err)
	}
	if authenticated.Username != "john_doe" || len(authenticated.Roles) != 2 {
		t.Errorf("unexpected authenticated user details: %+v", authenticated)
	}

	// 5. Authenticate with wrong password -> fails
	_, err = userRepo.Authenticate(ctx, "tenant-idp", "john_doe", "wrong-password")
	if !errors.Is(err, idp.ErrInvalidCredentials) {
		t.Errorf("expected ErrInvalidCredentials, got: %v", err)
	}
}

func TestBuiltInIdP_InteractiveLoginAndConsentFlow(t *testing.T) {
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{Driver: "sqlite", URL: ":memory:", MaxConns: 1})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()
	_ = migrations.MigrateUp(ctx, db)

	_ = storage.NewSQLTenantRepository(db).CreateTenant(ctx, &tenants.Tenant{ID: "t-interactive", Name: "T", Slug: "t"})

	userRepo, _ := idp.NewSQLUserRepository(db, 4)
	_ = userRepo.CreateUser(ctx, &idp.User{
		TenantID: "t-interactive",
		Username: "alice",
		Email:    "alice@example.com",
	}, "alice-password-123")

	consentRepo, _ := oauth.NewSQLAuthorizationService(db)
	secret := []byte("thirty-two-bytes-minimum-session-key-!")
	interactiveSvc, err := idp.NewInteractiveService(userRepo, consentRepo, secret)
	if err != nil {
		t.Fatalf("interactive service: %v", err)
	}

	// Register OAuth Client
	_, _ = db.ExecContext(ctx, `
		INSERT INTO oauth_clients (id, tenant_id, client_id, client_type, allowed_grant_types, allowed_scopes)
		VALUES ('c1', 't-interactive', 'cli-app', 'CONFIDENTIAL', '["authorization_code"]', '["mcp:tools:call"]')`)

	// 1. Submit login POST
	loginForm := url.Values{
		"tenant_id": {"t-interactive"},
		"username":  {"alice"},
		"password":  {"alice-password-123"},
		"return_to": {"/consent?client_id=cli-app&scope=mcp:tools:call"},
	}
	loginReq := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(loginForm.Encode()))
	loginReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rrLogin := httptest.NewRecorder()
	interactiveSvc.HandleLogin(rrLogin, loginReq)

	if rrLogin.Code != http.StatusSeeOther {
		t.Fatalf("expected 303 SeeOther redirect after login, got %d", rrLogin.Code)
	}
	cookies := rrLogin.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == idp.SessionCookieName {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatalf("expected session cookie to be set after login")
	}

	// 2. Submit consent POST with the session cookie
	consentForm := url.Values{
		"client_id": {"cli-app"},
		"scope":     {"mcp:tools:call"},
		"decision":  {"approve"},
		"return_to": {"/oauth/authorize?response_type=code"},
	}
	consentReq := httptest.NewRequest(http.MethodPost, "/consent", strings.NewReader(consentForm.Encode()))
	consentReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	consentReq.AddCookie(sessionCookie)
	rrConsent := httptest.NewRecorder()
	interactiveSvc.HandleConsent(rrConsent, consentReq)

	if rrConsent.Code != http.StatusSeeOther {
		t.Fatalf("expected 303 SeeOther redirect after consent, got %d", rrConsent.Code)
	}

	// 3. Now verify Authorize decision succeeds with approved scopes
	clientObj := &oauth.Client{
		ClientID:      "cli-app",
		TenantID:      "t-interactive",
		AllowedScopes: []string{"mcp:tools:call"},
	}
	authReq := httptest.NewRequest(http.MethodGet, "/oauth/authorize", nil)
	authReq.AddCookie(sessionCookie)

	decision, err := interactiveSvc.Authorize(ctx, authReq, clientObj, []string{"mcp:tools:call"})
	if err != nil {
		t.Fatalf("expected successful authorization decision, got: %v", err)
	}
	if len(decision.Scopes) != 1 || decision.Scopes[0] != "mcp:tools:call" {
		t.Errorf("unexpected scopes in decision: %v", decision.Scopes)
	}
}
