package resilience

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ============================================================================
// Breaker Registry & Bulkhead Registry Tests
// ============================================================================

func TestCircuitBreakerRegistry(t *testing.T) {
	reg := NewCircuitBreakerRegistry()

	var stateChanges []string
	reg.SetStateChangeHook(func(name string, from, to State) {
		stateChanges = append(stateChanges, name+":"+from.String()+"->"+to.String())
	})

	cb := reg.GetOrCreate("test-upstream", 2, 50*time.Millisecond)
	if cb == nil {
		t.Fatal("expected non-nil circuit breaker")
	}

	// Trip the breaker
	failOp := func(ctx context.Context) error { return errors.New("upstream timeout") }
	_ = cb.Execute(context.Background(), failOp)
	_ = cb.Execute(context.Background(), failOp)

	if cb.State() != StateOpen {
		t.Errorf("expected breaker to be OPEN, got %v", cb.State())
	}

	stats := reg.GetAllStats()
	if len(stats) != 1 {
		t.Errorf("expected 1 breaker in stats, got %d", len(stats))
	}
	if stats["test-upstream"].ConsecutiveFailures != 2 {
		t.Errorf("expected 2 consecutive failures, got %d", stats["test-upstream"].ConsecutiveFailures)
	}

	reg.ResetAll()
	if cb.State() != StateClosed {
		t.Errorf("expected breaker to reset to CLOSED, got %v", cb.State())
	}
}

func TestBulkheadRegistry(t *testing.T) {
	reg := NewBulkheadRegistry()

	bh := reg.GetOrCreate("upstream-a", 2)
	if bh.Limit() != 2 {
		t.Errorf("expected limit 2, got %d", bh.Limit())
	}

	ctx := context.Background()
	if err := bh.Acquire(ctx); err != nil {
		t.Fatalf("first acquire failed: %v", err)
	}
	if err := bh.Acquire(ctx); err != nil {
		t.Fatalf("second acquire failed: %v", err)
	}

	if bh.InFlight() != 2 {
		t.Errorf("expected 2 in flight, got %d", bh.InFlight())
	}

	// Third acquire should fail
	err := bh.Acquire(ctx)
	if !errors.Is(err, ErrConcurrencyLimitReached) {
		t.Errorf("expected ErrConcurrencyLimitReached, got %v", err)
	}

	bh.Release()
	if bh.InFlight() != 1 {
		t.Errorf("expected 1 in flight after release, got %d", bh.InFlight())
	}

	stats := reg.GetAllStats()
	if stats["upstream-a"].InFlight != 1 {
		t.Errorf("expected 1 in flight in stats, got %d", stats["upstream-a"].InFlight)
	}
}

// ============================================================================
// Rate Limiter Tests
// ============================================================================

func TestRateLimiter_TokenBucket(t *testing.T) {
	rl := NewRateLimiter(RateLimiterConfig{
		RequestsPerMinute: 60, // 1 token per sec
		Burst:             3,
	})

	// 1. Consume burst tokens
	res1 := rl.Allow("tenant-a")
	if !res1.Allowed || res1.Remaining != 2 {
		t.Errorf("expected allowed=true, remaining=2, got %+v", res1)
	}

	res2 := rl.Allow("tenant-a")
	if !res2.Allowed || res2.Remaining != 1 {
		t.Errorf("expected allowed=true, remaining=1, got %+v", res2)
	}

	res3 := rl.Allow("tenant-a")
	if !res3.Allowed || res3.Remaining != 0 {
		t.Errorf("expected allowed=true, remaining=0, got %+v", res3)
	}

	// 2. Fourth request exceeds burst
	res4 := rl.Allow("tenant-a")
	if res4.Allowed {
		t.Errorf("expected allowed=false when burst exhausted, got %+v", res4)
	}
	if res4.RetryAfter <= 0 {
		t.Errorf("expected positive RetryAfter, got %v", res4.RetryAfter)
	}

	// 3. Different tenant is not affected (tenant isolation)
	resTenantB := rl.Allow("tenant-b")
	if !resTenantB.Allowed {
		t.Errorf("tenant-b should have full burst available, got %+v", resTenantB)
	}
}

func TestRateLimiter_Middleware(t *testing.T) {
	rl := NewRateLimiter(RateLimiterConfig{
		RequestsPerMinute: 60,
		Burst:             1,
	})

	handler := RateLimitMiddleware(rl, func(r *http.Request) string {
		return r.Header.Get("X-Tenant-ID")
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	// 1. First request allowed
	req1 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req1.Header.Set("X-Tenant-ID", "tenant-alpha")
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Errorf("expected 200 OK for first request, got %d", w1.Code)
	}
	if w1.Header().Get("X-RateLimit-Limit") == "" {
		t.Errorf("missing X-RateLimit-Limit header")
	}

	// 2. Second request immediately rejected with 429
	req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req2.Header.Set("X-Tenant-ID", "tenant-alpha")
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 Too Many Requests, got %d", w2.Code)
	}
	if w2.Header().Get("Retry-After") == "" {
		t.Errorf("missing Retry-After header on 429")
	}
}

// ============================================================================
// Request Size Limiting Tests
// ============================================================================

func TestMaxBytesMiddleware_RejectsOversizedContentLength(t *testing.T) {
	middleware := MaxBytesMiddleware(1024) // 1KB limit

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/upload", bytes.NewReader(make([]byte, 2048)))
	req.ContentLength = 2048
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 Request Entity Too Large, got %d", rec.Code)
	}
}

func TestMaxBytesMiddleware_RejectsOversizedStreamingBody(t *testing.T) {
	middleware := MaxBytesMiddleware(1024) // 1KB limit

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			if IsMaxBytesError(err) {
				http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	// Chunked / unknown content length with 2KB data
	req := httptest.NewRequest(http.MethodPost, "/upload", bytes.NewReader(make([]byte, 2048)))
	req.ContentLength = -1 // streaming/chunked
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 for streaming read exceeding max bytes, got %d", rec.Code)
	}
}

func TestMaxBytesMiddleware_AllowsPermittedSize(t *testing.T) {
	middleware := MaxBytesMiddleware(1024)

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))

	payload := []byte("hello world")
	req := httptest.NewRequest(http.MethodPost, "/upload", bytes.NewReader(payload))
	req.ContentLength = int64(len(payload))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for payload within limit, got %d", rec.Code)
	}
}
