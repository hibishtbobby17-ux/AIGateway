package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"project_alpha/internal/api/admin"
	"project_alpha/internal/audit"
	"project_alpha/internal/config"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
	"project_alpha/internal/tenants"
	"project_alpha/migrations"
)

func TestAdminHandler_AuditAndPolicyOperations(t *testing.T) {
	ctx := context.Background()

	// 1. Setup in-memory db with schema migrations
	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening test db: %v", err)
	}
	defer db.Close()

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{
		ID:   "tenant-admin-1",
		Name: "Admin Tenant",
		Slug: "admin-tenant",
	})

	policyRepo, err := policy.NewSQLRepository(db)
	if err != nil {
		t.Fatalf("failed creating policy repo: %v", err)
	}

	recorder := audit.NewSQLRecorder(db)
	handler := admin.NewHandler(recorder, policyRepo, tenantsRepo)

	adminCaller := principal.Principal{
		Subject:  "super-admin",
		TenantID: "tenant-admin-1",
		Roles:    []string{"tenant-admin"},
	}

	// 2. Test Create Policy
	policyReqBody := `{
		"id": "policy-allow-mcp",
		"name": "Allow MCP Tools",
		"effect": "ALLOW",
		"actions": ["mcp:tools:call"],
		"resources": ["*"],
		"roles": ["tool-consumer"]
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/policies", bytes.NewBufferString(policyReqBody))
	req = req.WithContext(principal.WithContext(req.Context(), adminCaller))
	rr := httptest.NewRecorder()

	handler.HandleCreatePolicy(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	// 3. Test List Policies
	reqList := httptest.NewRequest(http.MethodGet, "/api/v1/policies", nil)
	reqList = reqList.WithContext(principal.WithContext(reqList.Context(), adminCaller))
	rrList := httptest.NewRecorder()

	handler.HandleListPolicies(rrList, reqList)
	if rrList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrList.Code)
	}

	var rules []*policy.Rule
	if err := json.Unmarshal(rrList.Body.Bytes(), &rules); err != nil {
		t.Fatalf("failed unmarshaling rules: %v", err)
	}
	if len(rules) != 1 || rules[0].ID != "policy-allow-mcp" {
		t.Fatalf("expected 1 rule with ID policy-allow-mcp, got %+v", rules)
	}

	// 4. Test Get Audit (must show the policy creation event)
	reqAudit := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	reqAudit = reqAudit.WithContext(principal.WithContext(reqAudit.Context(), adminCaller))
	rrAudit := httptest.NewRecorder()

	handler.HandleGetAudit(rrAudit, reqAudit)
	if rrAudit.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for audit query, got %d", rrAudit.Code)
	}

	var events []audit.Event
	if err := json.Unmarshal(rrAudit.Body.Bytes(), &events); err != nil {
		t.Fatalf("failed unmarshaling audit events: %v", err)
	}
	if len(events) != 1 || events[0].Action != audit.ActionPolicyCreate {
		t.Fatalf("expected 1 audit event for ActionPolicyCreate, got %+v", events)
	}
	if events[0].ResourceID != "policy-allow-mcp" {
		t.Errorf("expected resource_id policy-allow-mcp, got %s", events[0].ResourceID)
	}

	// 5. Test Get Tenant
	reqTenant := httptest.NewRequest(http.MethodGet, "/api/v1/tenants", nil)
	reqTenant = reqTenant.WithContext(principal.WithContext(reqTenant.Context(), adminCaller))
	rrTenant := httptest.NewRecorder()

	handler.HandleGetTenant(rrTenant, reqTenant)
	if rrTenant.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for get tenant, got %d", rrTenant.Code)
	}
}
