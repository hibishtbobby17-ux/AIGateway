package resilience

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestCircuitBreakerTripsAndRecovers(t *testing.T) {
	cb := NewCircuitBreaker("test-service", 3, 50*time.Millisecond)

	mockErr := errors.New("upstream connection reset")

	// 1. Fail twice (threshold is 3, stays closed)
	for i := 0; i < 2; i++ {
		err := cb.Execute(context.Background(), func(ctx context.Context) error {
			return mockErr
		})
		if !errors.Is(err, mockErr) {
			t.Fatalf("expected mock error, got: %v", err)
		}
	}

	// 2. 3rd failure trips to OPEN
	_ = cb.Execute(context.Background(), func(ctx context.Context) error {
		return mockErr
	})

	// 3. Next execution should immediately fail-fast with ErrCircuitBreakerOpen
	err := cb.Execute(context.Background(), func(ctx context.Context) error {
		return nil
	})
	if !errors.Is(err, ErrCircuitBreakerOpen) {
		t.Fatalf("expected ErrCircuitBreakerOpen, got: %v", err)
	}

	// 4. Wait for cooldown to expire
	time.Sleep(60 * time.Millisecond)

	// 5. In Half-Open state, successful call should reset to CLOSED
	err = cb.Execute(context.Background(), func(ctx context.Context) error {
		return nil
	})
	if err != nil {
		t.Fatalf("expected success in Half-Open state, got: %v", err)
	}

	// 6. Verify subsequent call succeeds
	err = cb.Execute(context.Background(), func(ctx context.Context) error {
		return nil
	})
	if err != nil {
		t.Fatalf("expected success after recovery, got: %v", err)
	}
}

func TestBulkheadConcurrencyLimit(t *testing.T) {
	bh := NewBulkhead(2)

	// Acquire 2 slots
	if err := bh.Acquire(context.Background()); err != nil {
		t.Fatalf("failed acquiring slot 1: %v", err)
	}
	if err := bh.Acquire(context.Background()); err != nil {
		t.Fatalf("failed acquiring slot 2: %v", err)
	}

	// 3rd acquire must fail with ErrConcurrencyLimitReached
	if err := bh.Acquire(context.Background()); !errors.Is(err, ErrConcurrencyLimitReached) {
		t.Fatalf("expected ErrConcurrencyLimitReached, got: %v", err)
	}

	// Release 1 slot
	bh.Release()

	// Now acquire succeeds
	if err := bh.Acquire(context.Background()); err != nil {
		t.Fatalf("expected success after release, got: %v", err)
	}
}
