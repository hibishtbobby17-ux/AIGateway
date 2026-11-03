package security_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"AIGateway/internal/api/middleware"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/tokens"
	"AIGateway/internal/mcp/aggregation"
	"AIGateway/internal/mcp/protocol"
	"AIGateway/internal/mcp/registry"
	"AIGateway/internal/mcp/session"
	"AIGateway/internal/mcp/transport"
	"AIGateway/internal/mcp/upstream"
	"AIGateway/internal/policy"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

func setupSecurityTestEnvironment(t *testing.T) (
	*tokens.Verifier,
	*keys.Manager,
	*policy.Engine,
	*registry.MemoryRegistry,
	*transport.GatewayHandler,
) {
	t.Helper()
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-a", Name: "Tenant A", Slug: "tenant-a"})
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-b", Name: "Tenant B", Slug: "tenant-b"})

	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("failed creating key manager: %v", err)
	}
	revocationStore := tokens.NewRevocationManager()
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://gateway.example.com", "ai-gateway")

	policyRepo, _ := policy.NewSQLRepository(db)
	_ = policyRepo.CreateRule(ctx, &policy.Rule{
		ID:        "allow-a-tools",
		TenantID:  "tenant-a",
		Name:      "Allow A",
		Effect:    policy.EffectAllow,
		Actions:   []string{"mcp:tools:discover", "mcp:tools:call"},
		Resources: []string{"*"},
		Roles:     []string{"tool-consumer"},
	})
	_ = policyRepo.CreateRule(ctx, &policy.Rule{
		ID:        "allow-b-tools",
		TenantID:  "tenant-b",
		Name:      "Allow B",
		Effect:    policy.EffectAllow,
		Actions:   []string{"mcp:tools:discover", "mcp:tools:call"},
		Resources: []string{"*"},
		Roles:     []string{"tool-consumer"},
	})

	policyEngine, err := policyRepo.LoadEngine(ctx)
	if err != nil {
		t.Fatalf("failed loading engine: %v", err)
	}

	mcpRegistry := registry.NewMemoryRegistry()
	mockClientA := upstream.NewMockClient()
	mockClientA.AddTool(protocol.Tool{Name: "secret_tool_a", Description: "Secret A"}, nil)
	_ = mcpRegistry.RegisterServer(ctx, &registry.ServerRegistration{
		ID:              "srv-a",
		TenantID:        "tenant-a",
		Name:            "server-a",
		NamespacePrefix: "server-a",
		Client:          mockClientA,
	})

	mockClientB := upstream.NewMockClient()
	mockClientB.AddTool(protocol.Tool{Name: "secret_tool_b", Description: "Secret B"}, nil)
	_ = mcpRegistry.RegisterServer(ctx, &registry.ServerRegistration{
		ID:              "srv-b",
		TenantID:        "tenant-b",
		Name:            "server-b",
		NamespacePrefix: "server-b",
		Client:          mockClientB,
	})

	aggregator := aggregation.NewAggregator(mcpRegistry, time.Minute)
	sessions := session.NewManager()
	mcpHandler := transport.NewGatewayHandler(aggregator, sessions, "default")
	mcpHandler.SetPolicyEngine(policyEngine)

	return verifier, keyManager, policyEngine, mcpRegistry, mcpHandler
}

func issueTestToken(t *testing.T, keyManager *keys.Manager, tenantID, subject string, roles, scopes []string) string {
	t.Helper()
	activeKey, err := keyManager.GetActiveKey()
	if err != nil {
		t.Fatalf("active key failed: %v", err)
	}
	now := time.Now().UTC()
	if len(scopes) == 0 {
		scopes = []string{"mcp:tools:discover", "mcp:tools:call"}
	}
	claims := &tokens.Claims{
		Issuer:    "https://gateway.example.com",
		Subject:   subject,
		Audience:  "ai-gateway",
		TenantID:  tenantID,
		Roles:     roles,
		Scopes:    scopes,
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(time.Hour).Unix(),
		TokenID:   "token-sec-1",
	}
	tokenStr, err := tokens.Sign(claims, activeKey)
	if err != nil {
		t.Fatalf("sign token failed: %v", err)
	}
	return tokenStr
}

func TestSecurity_TenantIsolation(t *testing.T) {
	verifier, keyManager, policyEngine, _, mcpHandler := setupSecurityTestEnvironment(t)

	mux := http.NewServeMux()
	mux.HandleFunc("/mcp/v1/messages", mcpHandler.HandleMessages)
	protectedHandler := middleware.AuthMiddleware(verifier, policyEngine)(mux)

	tokenA := issueTestToken(t, keyManager, "tenant-a", "alice", []string{"tool-consumer"}, []string{"mcp:tools:discover", "mcp:tools:call"})
	tokenB := issueTestToken(t, keyManager, "tenant-b", "bob", []string{"tool-consumer"}, []string{"mcp:tools:discover", "mcp:tools:call"})

	// Test 1: Tenant A tool discovery only returns Tenant A tools
	listToolsReq := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	reqA := httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(listToolsReq))
	reqA.Header.Set("Authorization", "Bearer "+tokenA)
	rrA := httptest.NewRecorder()
	protectedHandler.ServeHTTP(rrA, reqA)

	if rrA.Code != http.StatusOK {
		t.Fatalf("expected 200 for tenant-a tools/list, got %d", rrA.Code)
	}
	if !strings.Contains(rrA.Body.String(), "server-a::secret_tool_a") {
		t.Errorf("tenant-a should see secret_tool_a, body: %s", rrA.Body.String())
	}
	if strings.Contains(rrA.Body.String(), "secret_tool_b") {
		t.Errorf("SECURITY VIOLATION: tenant-a saw tenant-b tool in tools/list! Body: %s", rrA.Body.String())
	}

	// Test 2: Tenant A attempting to invoke Tenant B's tool
	callToolBReq := `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"server-b::secret_tool_b","arguments":{}}}`
	reqCross := httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(callToolBReq))
	reqCross.Header.Set("Authorization", "Bearer "+tokenA)
	rrCross := httptest.NewRecorder()
	protectedHandler.ServeHTTP(rrCross, reqCross)

	if !strings.Contains(rrCross.Body.String(), "not permitted") && !strings.Contains(rrCross.Body.String(), "not registered") {
		t.Errorf("SECURITY VIOLATION: cross-tenant tool invocation did not fail closed! Response: %s", rrCross.Body.String())
	}

	// Test 3: Header Spoofing Attack
	// Caller supplies Token A (tenant-a) but sends header X-Tenant-ID: tenant-b
	reqSpoof := httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(listToolsReq))
	reqSpoof.Header.Set("Authorization", "Bearer "+tokenA)
	reqSpoof.Header.Set("X-Tenant-ID", "tenant-b")
	rrSpoof := httptest.NewRecorder()
	protectedHandler.ServeHTTP(rrSpoof, reqSpoof)

	if rrSpoof.Code != http.StatusForbidden {
		t.Errorf("SECURITY VIOLATION: expected 403 Forbidden for X-Tenant-ID header spoofing, got %d: %s", rrSpoof.Code, rrSpoof.Body.String())
	}

	// Test 4: Tenant B tool discovery only returns Tenant B tools
	reqB := httptest.NewRequest(http.MethodPost, "/mcp/v1/messages", strings.NewReader(listToolsReq))
	reqB.Header.Set("Authorization", "Bearer "+tokenB)
	rrB := httptest.NewRecorder()
	protectedHandler.ServeHTTP(rrB, reqB)

	if rrB.Code != http.StatusOK {
		t.Fatalf("expected 200 for tenant-b, got %d", rrB.Code)
	}
	if !strings.Contains(rrB.Body.String(), "server-b::secret_tool_b") {
		t.Errorf("tenant-b should see secret_tool_b, body: %s", rrB.Body.String())
	}
	if strings.Contains(rrB.Body.String(), "secret_tool_a") {
		t.Errorf("SECURITY VIOLATION: tenant-b saw tenant-a tool! Body: %s", rrB.Body.String())
	}
}

func TestSecurity_TokenRevocationAndTampering(t *testing.T) {
	keyManager, err := keys.NewManager()
	if err != nil {
		t.Fatalf("key manager failed: %v", err)
	}
	revocationStore := tokens.NewRevocationManager()
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://gateway.example.com", "ai-gateway")
	policyEngine := policy.NewEngine()

	mux := http.NewServeMux()
	mux.HandleFunc("/protected", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	handler := middleware.AuthMiddleware(verifier, policyEngine)(mux)

	// Valid token
	tokenStr := issueTestToken(t, keyManager, "tenant-a", "charlie", []string{"tool-consumer"}, nil)

	req1 := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req1.Header.Set("Authorization", "Bearer "+tokenStr)
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Errorf("expected 200 for valid token, got %d", rr1.Code)
	}

	// Revoke token
	revocationStore.Revoke("token-sec-1", time.Now().Add(time.Hour))

	req2 := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req2.Header.Set("Authorization", "Bearer "+tokenStr)
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for revoked token, got %d: %s", rr2.Code, rr2.Body.String())
	}

	// Tampered signature
	tamperedToken := tokenStr[:len(tokenStr)-4] + "ABCD"
	req3 := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req3.Header.Set("Authorization", "Bearer "+tamperedToken)
	rr3 := httptest.NewRecorder()
	handler.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for tampered token, got %d", rr3.Code)
	}
}
