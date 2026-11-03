package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"AIGateway/internal/api/admin"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/idp"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/oidc"
	"AIGateway/internal/identity/principal"
	"AIGateway/internal/storage"
	"AIGateway/migrations"
)

func setupSSOTestHandler(t *testing.T) (*admin.Handler, *oidc.SQLProviderRepository, idp.UserRepository) {
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

	_, err = db.ExecContext(ctx, "INSERT INTO tenants (id, name, slug) VALUES ('tenant-1', 'Acme Tenant', 'acme')")
	if err != nil {
		t.Fatalf("failed inserting test tenant: %v", err)
	}

	userRepo, err := idp.NewSQLUserRepository(db, 10)
	if err != nil {
		t.Fatalf("failed creating user repo: %v", err)
	}

	oidcRepo, err := oidc.NewSQLProviderRepository(db)
	if err != nil {
		t.Fatalf("failed creating oidc repo: %v", err)
	}

	keyMgr, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}

	h := admin.NewHandlerWithConfig(admin.Config{
		OIDCRepo:       oidcRepo,
		OIDCDiscoverer: oidc.NewDiscoverer(true, 5*time.Second),
		UserRepo:       userRepo,
		KeyManager:     keyMgr,
		JWTIssuer:      "https://gateway.local",
		JWTAudience:    "https://gateway.local/api",
	})

	return h, oidcRepo, userRepo
}

func TestHandleSSOProviders_CRUD(t *testing.T) {
	h, _, _ := setupSSOTestHandler(t)

	p := principal.Principal{
		Subject:  "admin",
		TenantID: "tenant-1",
		Roles:    []string{"platform-admin"},
	}

	// 1. List initially empty
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sso/providers", nil)
	req = req.WithContext(principal.WithContext(req.Context(), p))
	rec := httptest.NewRecorder()
	h.HandleSSOProviders(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got: %d", rec.Code)
	}
	var list []*oidc.ProviderConfig
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("expected 0 providers, got: %d", len(list))
	}

	// 2. Create provider
	body, _ := json.Marshal(admin.SSOProviderRequest{
		ID:        "okta-corp",
		Name:      "Okta Corporate",
		IssuerURL: "https://acme.okta.com",
		ClientID:  "client-12345",
		ClaimMapping: map[string]string{
			"okta-admins": "platform-admin",
		},
		Active: true,
	})
	reqPost := httptest.NewRequest(http.MethodPost, "/api/v1/sso/providers", bytes.NewReader(body))
	reqPost = reqPost.WithContext(principal.WithContext(reqPost.Context(), p))
	recPost := httptest.NewRecorder()
	h.HandleSSOProviders(recPost, reqPost)

	if recPost.Code != http.StatusOK {
		t.Fatalf("expected 200 on post, got %d: %s", recPost.Code, recPost.Body.String())
	}

	// 3. List again (now 1)
	reqList2 := httptest.NewRequest(http.MethodGet, "/api/v1/sso/providers", nil)
	reqList2 = reqList2.WithContext(principal.WithContext(reqList2.Context(), p))
	recList2 := httptest.NewRecorder()
	h.HandleSSOProviders(recList2, reqList2)

	_ = json.Unmarshal(recList2.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("expected 1 provider, got: %d", len(list))
	}
	if list[0].Name != "Okta Corporate" || list[0].ClaimMapping["okta-admins"] != "platform-admin" {
		t.Fatalf("unexpected provider contents: %+v", list[0])
	}

	// 4. Delete provider
	reqDel := httptest.NewRequest(http.MethodDelete, "/api/v1/sso/providers/okta-corp", nil)
	reqDel = reqDel.WithContext(principal.WithContext(reqDel.Context(), p))
	recDel := httptest.NewRecorder()
	h.HandleSSOProviders(recDel, reqDel)

	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on delete, got: %d", recDel.Code)
	}

	// 5. Verify deleted
	reqList3 := httptest.NewRequest(http.MethodGet, "/api/v1/sso/providers", nil)
	reqList3 = reqList3.WithContext(principal.WithContext(reqList3.Context(), p))
	recList3 := httptest.NewRecorder()
	h.HandleSSOProviders(recList3, reqList3)

	_ = json.Unmarshal(recList3.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("expected 0 providers after delete, got: %d", len(list))
	}
}

func TestHandleTestSSODiscovery(t *testing.T) {
	h, _, _ := setupSSOTestHandler(t)

	var mockIssuer string
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oidc.OpenIDConfiguration{
			Issuer:                mockIssuer,
			AuthorizationEndpoint: mockIssuer + "/oauth2/v1/authorize",
			TokenEndpoint:         mockIssuer + "/oauth2/v1/token",
			JWKSURI:               mockIssuer + "/oauth2/v1/keys",
		})
	}))
	defer mockServer.Close()
	mockIssuer = mockServer.URL

	body, _ := json.Marshal(map[string]string{"issuer_url": mockIssuer})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sso/test", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.HandleTestSSODiscovery(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for discovery, got %d: %s", rec.Code, rec.Body.String())
	}

	var res map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res["status"] != "ok" {
		t.Fatalf("expected status 'ok', got: %v", res["status"])
	}
}

func TestHandlePublicSSOProviders(t *testing.T) {
	h, oidcRepo, _ := setupSSOTestHandler(t)

	ctx := context.Background()
	_ = oidcRepo.SaveProvider(ctx, &oidc.ProviderConfig{
		ID:        "entra",
		TenantID:  "tenant-1",
		Name:      "Microsoft Entra ID",
		IssuerURL: "https://login.microsoftonline.com/tenant/v2.0",
		ClientID:  "entra-client",
		Active:    true,
	})
	_ = oidcRepo.SaveProvider(ctx, &oidc.ProviderConfig{
		ID:        "disabled-idp",
		TenantID:  "tenant-1",
		Name:      "Old IdP",
		IssuerURL: "https://old.idp.local",
		ClientID:  "old-client",
		Active:    false,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/sso/providers?tenant_id=tenant-1", nil)
	rec := httptest.NewRecorder()
	h.HandlePublicSSOProviders(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got: %d", rec.Code)
	}

	var publicList []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &publicList)
	if len(publicList) != 1 {
		t.Fatalf("expected only 1 active provider in public list, got: %d", len(publicList))
	}
	if publicList[0]["id"] != "entra" {
		t.Fatalf("expected entra provider, got: %v", publicList[0]["id"])
	}
}

func TestHandleSimulateSSOLogin(t *testing.T) {
	h, oidcRepo, _ := setupSSOTestHandler(t)

	ctx := context.Background()
	_ = oidcRepo.SaveProvider(ctx, &oidc.ProviderConfig{
		ID:        "okta-dev",
		TenantID:  "tenant-1",
		Name:      "Okta Dev",
		IssuerURL: "https://dev.okta.com",
		ClientID:  "okta-client",
		ClaimMapping: map[string]string{
			"sec-admins": "platform-admin",
		},
		Active: true,
	})

	simBody, _ := json.Marshal(map[string]any{
		"provider_id": "okta-dev",
		"tenant_id":   "tenant-1",
		"email":       "alex@example.com",
		"groups":      []string{"sec-admins", "developers"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/sso/simulate", bytes.NewReader(simBody))
	rec := httptest.NewRecorder()
	h.HandleSimulateSSOLogin(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on simulate SSO login, got %d: %s", rec.Code, rec.Body.String())
	}

	var res map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res["token"] == nil || res["token"] == "" {
		t.Fatalf("expected non-empty token")
	}

	cookies := rec.Result().Cookies()
	var foundSessionCookie bool
	for _, c := range cookies {
		if c.Name == "gateway_console_session" {
			foundSessionCookie = true
			if !c.HttpOnly {
				t.Errorf("expected session cookie to be HttpOnly")
			}
		}
	}
	if !foundSessionCookie {
		t.Errorf("expected gateway_console_session cookie to be set")
	}
}
