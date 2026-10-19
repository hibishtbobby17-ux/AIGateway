package health

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLivenessHandler(t *testing.T) {
	h := NewHandler()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	h.LivenessHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got: %d", rec.Code)
	}
}

func TestReadinessHandlerLifecycle(t *testing.T) {
	h := NewHandler()

	// Initial state: not ready
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	h.ReadinessHandler(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 before ready, got: %d", rec.Code)
	}

	// Set ready without checks
	h.SetReady(true)
	rec = httptest.NewRecorder()
	h.ReadinessHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 when ready, got: %d", rec.Code)
	}

	// Register failing check
	h.RegisterCheck("db", func() error {
		return errors.New("connection failed")
	})
	rec = httptest.NewRecorder()
	h.ReadinessHandler(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 when check fails, got: %d", rec.Code)
	}

	// Fix check
	h.RegisterCheck("db", func() error {
		return nil
	})
	rec = httptest.NewRecorder()
	h.ReadinessHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 when all checks pass, got: %d", rec.Code)
	}
}
