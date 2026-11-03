package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"AIGateway/internal/api/admin"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/idp"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

func setupAuthTest(t *testing.T) (*admin.Handler, idp.UserRepository) {
	t.Helper()
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening test db: %v", err)
	}

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{
		ID:   "tenant-1",
		Name: "Acme AI Labs",
		Slug: "acme-ai",
	})

	userRepo, err := idp.NewSQLUserRepository(db, 4)
	if err != nil {
		t.Fatalf("failed creating user repo: %v", err)
	}

	// Seed user admin / admin123
	err = userRepo.CreateUser(ctx, &idp.User{
		TenantID: "tenant-1",
		Username: "admin",
		Email:    "admin@gateway.local",
		Roles:    []string{"platform-admin", "tenant-admin"},
		Active:   true,
	}, "admin123")
	if err != nil {
		t.Fatalf("failed creating admin user: %v", err)
	}

	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}

	handler := admin.NewHandlerWithConfig(admin.Config{
		TenantsRepo: tenantsRepo,
		UserRepo:    userRepo,
		KeyManager:  keyManager,
		JWTIssuer:   "https://gateway.local",
		JWTAudience: "gateway-api",
	})

	return handler, userRepo
}

func TestHandleLogin_Success(t *testing.T) {
	handler, _ := setupAuthTest(t)

	body := []byte(`{"username":"admin","password":"admin123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.HandleLogin(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp admin.LoginResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Token == "" {
		t.Errorf("expected non-empty token")
	}
	if resp.User.Username != "admin" {
		t.Errorf("expected username admin, got %s", resp.User.Username)
	}
	if resp.User.TenantID != "tenant-1" {
		t.Errorf("expected tenant_id tenant-1, got %s", resp.User.TenantID)
	}

	// Verify cookie
	cookies := rec.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "gateway_console_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Errorf("expected gateway_console_session cookie to be set")
	} else if sessionCookie.Value != resp.Token {
		t.Errorf("cookie value mismatch")
	}
}

func TestHandleLogin_InvalidPassword(t *testing.T) {
	handler, _ := setupAuthTest(t)

	body := []byte(`{"username":"admin","password":"wrongpassword"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.HandleLogin(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected HTTP 401, got %d", rec.Code)
	}
}

func TestHandleLogin_MissingCredentials(t *testing.T) {
	handler, _ := setupAuthTest(t)

	body := []byte(`{"username":"","password":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.HandleLogin(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400, got %d", rec.Code)
	}
}

func TestHandleLogout(t *testing.T) {
	handler, _ := setupAuthTest(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	rec := httptest.NewRecorder()

	handler.HandleLogout(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d", rec.Code)
	}

	cookies := rec.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "gateway_console_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Errorf("expected gateway_console_session cookie to be set for deletion")
	} else if sessionCookie.MaxAge != -1 {
		t.Errorf("expected cookie MaxAge -1, got %d", sessionCookie.MaxAge)
	}
}

func TestHandleMe_Authenticated(t *testing.T) {
	handler, _ := setupAuthTest(t)

	ctx := context.Background()
	ctx = principal.WithContext(ctx, principal.Principal{
		Subject:  "user-123",
		TenantID: "tenant-1",
		Roles:    []string{"platform-admin"},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.HandleMe(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var user admin.UserSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &user); err != nil {
		t.Fatalf("failed decoding user summary: %v", err)
	}

	if user.TenantID != "tenant-1" {
		t.Errorf("expected tenant-1, got %s", user.TenantID)
	}
}
