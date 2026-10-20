package resilience_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"project_alpha/internal/api/health"
	"project_alpha/internal/resilience"
)

// ============================================================================
// 1. Bulkhead Isolation: Saturated Upstream A does NOT affect Upstream B
// ============================================================================

func TestBulkhead_UpstreamIsolation(t *testing.T) {
	reg := resilience.NewBulkheadRegistry()

	// Upstream A has capacity 2, Upstream B has capacity 5
	bulkheadA := reg.GetOrCreate("upstream-a", 2)
	bulkheadB := reg.GetOrCreate("upstream-b", 5)

	// Saturate Upstream A
	ctx := context.Background()
	if err := bulkheadA.Acquire(ctx); err != nil {
		t.Fatalf("failed acquiring slot 1 on A: %v", err)
	}
	if err := bulkheadA.Acquire(ctx); err != nil {
		t.Fatalf("failed acquiring slot 2 on A: %v", err)
	}

	// Verify Upstream A is completely saturated
	errA := bulkheadA.Acquire(ctx)
	if !errors.Is(errA, resilience.ErrConcurrencyLimitReached) {
		t.Fatalf("expected ErrConcurrencyLimitReached on saturated upstream A, got %v", errA)
	}

	// Verify Upstream B is completely unaffected and can acquire slots cleanly
	for i := 0; i < 5; i++ {
		if err := bulkheadB.Acquire(ctx); err != nil {
			t.Fatalf("upstream B acquire failed at iteration %d: %v", i, err)
		}
	}

	if bulkheadB.InFlight() != 5 {
		t.Errorf("expected 5 in-flight for upstream B, got %d", bulkheadB.InFlight())
	}

	// Release all
	bulkheadA.Release()
	bulkheadA.Release()
	for i := 0; i < 5; i++ {
		bulkheadB.Release()
	}
}

// ============================================================================
// 2. Circuit Breaker Fast-Failure & Half-Open Recovery
// ============================================================================

func TestCircuitBreaker_TripsAndHalfOpenProbe(t *testing.T) {
	cooldown := 60 * time.Millisecond
	cb := resilience.NewCircuitBreaker("flaky-service", 3, cooldown)

	failErr := errors.New("upstream connection reset")
	ctx := context.Background()

	// 3 consecutive failures trip the breaker
	for i := 0; i < 3; i++ {
		_ = cb.Execute(ctx, func(c context.Context) error {
			return failErr
		})
	}

	if cb.State() != resilience.StateOpen {
		t.Fatalf("expected breaker state OPEN, got %v", cb.State())
	}

	// While OPEN, requests must fail fast without executing the operation
	executed := false
	err := cb.Execute(ctx, func(c context.Context) error {
		executed = true
		return nil
	})
	if executed {
		t.Error("operation must not execute when breaker is OPEN")
	}
	if !errors.Is(err, resilience.ErrCircuitBreakerOpen) {
		t.Fatalf("expected ErrCircuitBreakerOpen, got %v", err)
	}

	// Await cooldown duration to allow transition to HALF-OPEN
	time.Sleep(cooldown + 10*time.Millisecond)

	// Next call should probe upstream in HALF-OPEN state
	probeExecuted := false
	err = cb.Execute(ctx, func(c context.Context) error {
		probeExecuted = true
		return nil // Probe succeeds
	})

	if !probeExecuted {
		t.Error("probe request must execute in HALF-OPEN state")
	}
	if err != nil {
		t.Fatalf("probe failed unexpectedly: %v", err)
	}

	// Successful probe must transition breaker back to CLOSED
	if cb.State() != resilience.StateClosed {
		t.Errorf("expected breaker to transition to CLOSED after successful probe, got %v", cb.State())
	}
}

// ============================================================================
// 3. Retries: Non-idempotent operations NEVER retried; Idempotent retried
// ============================================================================

func TestRetrier_IdempotencyEnforcement(t *testing.T) {
	retrier := resilience.NewRetrier(resilience.RetryConfig{
		MaxAttempts:    4,
		InitialBackoff: 5 * time.Millisecond,
		MaxBackoff:     20 * time.Millisecond,
		Multiplier:     2.0,
		FullJitter:     false,
	})

	ctx := context.Background()

	// Non-idempotent operation (e.g., tools/call with side-effects)
	t.Run("Non-idempotent operation fails on first attempt without retry", func(t *testing.T) {
		var attempts int32
		opErr := errors.New("503 Service Unavailable")

		err := retrier.Execute(ctx, false, func(c context.Context) error {
			atomic.AddInt32(&attempts, 1)
			return opErr
		})

		if !errors.Is(err, opErr) {
			t.Fatalf("expected error %v, got %v", opErr, err)
		}
		if atomic.LoadInt32(&attempts) != 1 {
			t.Errorf("non-idempotent operation must execute exactly once, got %d attempts", attempts)
		}
	})

	// Idempotent operation (e.g., tools/list, resources/list, read queries)
	t.Run("Idempotent operation retries with exponential backoff", func(t *testing.T) {
		var attempts int32

		err := retrier.Execute(ctx, true, func(c context.Context) error {
			count := atomic.AddInt32(&attempts, 1)
			if count < 3 {
				return errors.New("502 Bad Gateway")
			}
			return nil // Succeeds on 3rd attempt
		})

		if err != nil {
			t.Fatalf("expected eventual success, got error: %v", err)
		}
		if atomic.LoadInt32(&attempts) != 3 {
			t.Errorf("expected 3 attempts, got %d", attempts)
		}
	})
}

// ============================================================================
// 4. Deadline Awareness: Abort retry when insufficient time remains
// ============================================================================

func TestRetrier_DeadlineBudgetAwareness(t *testing.T) {
	retrier := resilience.NewRetrier(resilience.RetryConfig{
		MaxAttempts:    5,
		InitialBackoff: 200 * time.Millisecond, // larger than remaining context budget
		MaxBackoff:     1 * time.Second,
		FullJitter:     false,
	})

	// Context with only 30ms remaining
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	var attempts int32
	err := retrier.Execute(ctx, true, func(c context.Context) error {
		atomic.AddInt32(&attempts, 1)
		return errors.New("503 Service Unavailable")
	})

	if err == nil || !errors.Is(err, resilience.ErrDeadlineExceededBudget) {
		t.Fatalf("expected ErrDeadlineExceededBudget, got: %v", err)
	}
	if atomic.LoadInt32(&attempts) != 1 {
		t.Errorf("expected only 1 attempt before budget exhaustion abort, got %d", attempts)
	}
}

// ============================================================================
// 5. Rate Limiting Middleware: Rejection with 429 & Retry-After Header
// ============================================================================

func TestRateLimiter_RejectionAndHeaders(t *testing.T) {
	limiter := resilience.NewRateLimiter(resilience.RateLimiterConfig{
		RequestsPerMinute: 60,
		Burst:             2,
	})

	handler := resilience.RateLimitMiddleware(limiter, func(r *http.Request) string {
		return r.Header.Get("X-Tenant-ID")
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))

	// Requests 1 & 2 succeed
	for i := 1; i <= 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-Tenant-ID", "tenant-test")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d should succeed, got status %d", i, w.Code)
		}
	}

	// Request 3 exceeds burst: must return 429
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-Tenant-ID", "tenant-test")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header on 429 response")
	}
	if w.Header().Get("X-RateLimit-Limit") == "" {
		t.Error("expected X-RateLimit-Limit header")
	}
	if w.Header().Get("X-RateLimit-Remaining") != "0" {
		t.Errorf("expected 0 remaining, got %s", w.Header().Get("X-RateLimit-Remaining"))
	}
}

// ============================================================================
// 6. Request Size Limiting: Rejection with 413
// ============================================================================

func TestMaxBytesMiddleware_RejectsOversizedPayload(t *testing.T) {
	limit := int64(512) // 512 bytes
	middleware := resilience.MaxBytesMiddleware(limit)

	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			if resilience.IsMaxBytesError(err) {
				http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))

	// Payload with Content-Length larger than limit
	oversized := make([]byte, 1024)
	req := httptest.NewRequest(http.MethodPost, "/submit", bytes.NewReader(oversized))
	req.ContentLength = int64(len(oversized))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 Payload Too Large, got %d", w.Code)
	}
}

// ============================================================================
// 7. Graceful Draining: Readiness switches to 503 while in-flight finish
// ============================================================================

func TestGracefulDraining_ReadinessProbeAndInFlightCompletion(t *testing.T) {
	healthHandler := health.NewHandler()
	healthHandler.SetReady(true)

	var inFlightCount int32
	var inFlightDone sync.WaitGroup

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			healthHandler.ReadinessHandler(w, r)
			return
		}

		// In-flight work simulation
		atomic.AddInt32(&inFlightCount, 1)
		defer atomic.AddInt32(&inFlightCount, -1)
		inFlightDone.Done()

		time.Sleep(50 * time.Millisecond) // Long-running task
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("done"))
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}

	// 1. Initially ready
	resp, err := client.Get(server.URL + "/readyz")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK for initial readiness probe, got %d (err: %v)", resp.StatusCode, err)
	}

	// 2. Start an in-flight request
	inFlightDone.Add(1)
	inFlightCompleted := make(chan bool, 1)
	go func() {
		res, err := client.Get(server.URL + "/work")
		if err == nil && res.StatusCode == http.StatusOK {
			inFlightCompleted <- true
		} else {
			inFlightCompleted <- false
		}
	}()

	// Wait until in-flight request is actively processing
	inFlightDone.Wait()

	// 3. Initiate draining: Set readiness to false
	healthHandler.SetReady(false)

	// Readiness probe must immediately return 503 so load balancers stop routing
	drainResp, err := client.Get(server.URL + "/readyz")
	if err != nil || drainResp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable during draining, got %d", drainResp.StatusCode)
	}

	// 4. Verify in-flight request finishes cleanly without being aborted
	select {
	case ok := <-inFlightCompleted:
		if !ok {
			t.Error("in-flight request failed during draining")
		}
	case <-time.After(1 * time.Second):
		t.Error("timed out waiting for in-flight request to finish")
	}
}
