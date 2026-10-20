package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"project_alpha/internal/api/middleware"
	"project_alpha/internal/audit"
	"project_alpha/internal/identity/principal"
)

type mockAuditRecorder struct {
	recorded []audit.Event
}

func (m *mockAuditRecorder) Record(ctx context.Context, e audit.Event) error {
	m.recorded = append(m.recorded, e)
	return nil
}

func (m *mockAuditRecorder) Query(ctx context.Context, f audit.Filter) ([]audit.Event, error) {
	return m.recorded, nil
}

func TestRequireRoles(t *testing.T) {
	mockAudit := &mockAuditRecorder{}
	adminMiddleware := middleware.RequireRoles(mockAudit, "platform-admin", "tenant-admin")

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("admin success"))
	})

	handler := adminMiddleware(nextHandler)

	// Case 1: Unauthenticated -> 401
	req1 := httptest.NewRequest(http.MethodGet, "/admin/test", nil)
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr1.Code)
	}

	// Case 2: Authenticated with non-admin role -> 403 and Audit event recorded
	req2 := httptest.NewRequest(http.MethodPost, "/admin/test", nil)
	ctx2 := principal.WithContext(req2.Context(), principal.Principal{
		Subject:  "user-regular",
		TenantID: "tenant-1",
		Roles:    []string{"tool-consumer"},
	})
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2.WithContext(ctx2))
	if rr2.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr2.Code)
	}
	if len(mockAudit.recorded) != 1 {
		t.Fatalf("expected 1 audit event recorded, got %d", len(mockAudit.recorded))
	}
	if mockAudit.recorded[0].Outcome != audit.OutcomeDenied || mockAudit.recorded[0].ActorID != "user-regular" {
		t.Errorf("unexpected audit event: %+v", mockAudit.recorded[0])
	}

	// Case 3: Authenticated with tenant-admin role -> 200
	req3 := httptest.NewRequest(http.MethodGet, "/admin/test", nil)
	ctx3 := principal.WithContext(req3.Context(), principal.Principal{
		Subject:  "admin-bob",
		TenantID: "tenant-1",
		Roles:    []string{"tenant-admin"},
	})
	rr3 := httptest.NewRecorder()
	handler.ServeHTTP(rr3, req3.WithContext(ctx3))
	if rr3.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr3.Code)
	}
}
