package resilience_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"project_alpha/internal/resilience"
)

// ============================================================================
// Chaos Scenario 1: Upstream Intermittent Drops & Recovery Mid-Retry
// ============================================================================

func TestChaos_IntermittentDropsWithEventualRecovery(t *testing.T) {
	var callCount int32

	// Flaky upstream server that fails 2 times with 503 before succeeding
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&callCount, 1)
		if current <= 2 {
			w.Header().Set("Retry-After", "1")
			http.Error(w, "transient upstream crash", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"recovered"}`))
	}))
	defer mockServer.Close()

	retrier := resilience.NewRetrier(resilience.RetryConfig{
		MaxAttempts:    4,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	})

	httpClient := &http.Client{Timeout: 2 * time.Second}

	err := retrier.Execute(context.Background(), true, func(ctx context.Context) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, mockServer.URL, nil)
		if err != nil {
			return err
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 500 {
			return fmt.Errorf("upstream returned server error HTTP %d", resp.StatusCode)
		}
		return nil
	})

	if err != nil {
		t.Fatalf("expected successful recovery mid-retry, got error: %v", err)
	}
	if atomic.LoadInt32(&callCount) != 3 {
		t.Errorf("expected exactly 3 attempts (2 failures + 1 recovery), got %d", callCount)
	}
}

// ============================================================================
// Chaos Scenario 2: Severe Latency Spike & Context Cancellation
// ============================================================================

func TestChaos_UpstreamSevereLatencySpike(t *testing.T) {
	// Extremely slow upstream server
	mockSlowServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(500 * time.Millisecond) // Exceeds caller deadline
		w.WriteHeader(http.StatusOK)
	}))
	defer mockSlowServer.Close()

	retrier := resilience.NewRetrier(resilience.RetryConfig{
		MaxAttempts:    3,
		InitialBackoff: 20 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	})

	// Client enforces 50ms strict deadline
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	httpClient := &http.Client{}

	err := retrier.Execute(ctx, true, func(callCtx context.Context) error {
		req, err := http.NewRequestWithContext(callCtx, http.MethodGet, mockSlowServer.URL, nil)
		if err != nil {
			return err
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		return nil
	})

	if err == nil {
		t.Fatal("expected request to fail due to context deadline exceeded")
	}
}

// ============================================================================
// Chaos Scenario 3: Complete Outage Tripping Circuit Breaker Fast-Failure
// ============================================================================

func TestChaos_CompleteOutageTrippingCircuitBreaker(t *testing.T) {
	cb := resilience.NewCircuitBreaker("dead-upstream", 3, 50*time.Millisecond)

	var attemptedCalls int32
	failingOp := func(ctx context.Context) error {
		atomic.AddInt32(&attemptedCalls, 1)
		return errors.New("dial tcp: connection refused")
	}

	ctx := context.Background()

	// 3 failures trip the breaker
	for i := 0; i < 3; i++ {
		_ = cb.Execute(ctx, failingOp)
	}

	if cb.State() != resilience.StateOpen {
		t.Fatalf("expected breaker to be OPEN, got %v", cb.State())
	}

	// Next 10 calls must fail immediately without invoking the op
	for i := 0; i < 10; i++ {
		err := cb.Execute(ctx, failingOp)
		if !errors.Is(err, resilience.ErrCircuitBreakerOpen) {
			t.Errorf("call %d: expected ErrCircuitBreakerOpen, got %v", i, err)
		}
	}

	// Verify only the initial 3 calls actually executed
	if atomic.LoadInt32(&attemptedCalls) != 3 {
		t.Errorf("expected exactly 3 network execution attempts, got %d", attemptedCalls)
	}
}
