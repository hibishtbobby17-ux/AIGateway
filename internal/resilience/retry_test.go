package resilience

import (
	"context"
	"errors"
	"testing"
	"time"
)

type customRetryableErr struct {
	msg        string
	retryable  bool
	retryAfter time.Duration
}

func (e *customRetryableErr) Error() string { return e.msg }
func (e *customRetryableErr) IsRetryable() bool { return e.retryable }
func (e *customRetryableErr) RetryAfter() time.Duration { return e.retryAfter }

func TestRetrier_SuccessfulFirstAttempt(t *testing.T) {
	r := NewRetrier(DefaultRetryConfig())
	calls := 0
	err := r.Execute(context.Background(), true, func(ctx context.Context) error {
		calls++
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 1 {
		t.Errorf("expected 1 call, got %d", calls)
	}
}

func TestRetrier_NonIdempotentOperationDoesNotRetry(t *testing.T) {
	r := NewRetrier(RetryConfig{
		MaxAttempts:    3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     50 * time.Millisecond,
	})
	calls := 0
	expectedErr := errors.New("503 Service Unavailable")

	err := r.Execute(context.Background(), false, func(ctx context.Context) error {
		calls++
		return expectedErr
	})

	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
	if calls != 1 {
		t.Errorf("non-idempotent operation must execute exactly once, got %d calls", calls)
	}
}

func TestRetrier_RetriesOnTransientError(t *testing.T) {
	r := NewRetrier(RetryConfig{
		MaxAttempts:    3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     50 * time.Millisecond,
		FullJitter:     false,
	})

	calls := 0
	err := r.Execute(context.Background(), true, func(ctx context.Context) error {
		calls++
		if calls < 3 {
			return errors.New("connection reset by peer")
		}
		return nil
	})

	if err != nil {
		t.Fatalf("expected eventual success, got error: %v", err)
	}
	if calls != 3 {
		t.Errorf("expected 3 attempts, got %d", calls)
	}
}

func TestRetrier_AbortsOnNonRetryableError(t *testing.T) {
	r := NewRetrier(RetryConfig{
		MaxAttempts:    5,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     50 * time.Millisecond,
	})

	calls := 0
	fatalErr := errors.New("400 Bad Request: invalid json format")

	err := r.Execute(context.Background(), true, func(ctx context.Context) error {
		calls++
		return fatalErr
	})

	if !errors.Is(err, fatalErr) {
		t.Fatalf("expected %v, got %v", fatalErr, err)
	}
	if calls != 1 {
		t.Errorf("expected non-retryable error to fail immediately, got %d calls", calls)
	}
}

func TestRetrier_AbortsWhenDeadlineBudgetExceeded(t *testing.T) {
	r := NewRetrier(RetryConfig{
		MaxAttempts:    5,
		InitialBackoff: 500 * time.Millisecond, // long backoff
		MaxBackoff:     2 * time.Second,
		FullJitter:     false,
	})

	// Context with only 50ms remaining
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	calls := 0
	err := r.Execute(ctx, true, func(ctx context.Context) error {
		calls++
		return errors.New("503 Service Unavailable")
	})

	if err == nil || !errors.Is(err, ErrDeadlineExceededBudget) {
		t.Fatalf("expected ErrDeadlineExceededBudget, got %v", err)
	}
	if calls != 1 {
		t.Errorf("expected exactly 1 attempt before budget abort, got %d", calls)
	}
}

func TestRetrier_RespectsCustomRetryAfter(t *testing.T) {
	r := NewRetrier(RetryConfig{
		MaxAttempts:    3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	})

	start := time.Now()
	calls := 0
	err := r.Execute(context.Background(), true, func(ctx context.Context) error {
		calls++
		if calls == 1 {
			return &customRetryableErr{
				msg:        "429 Too Many Requests",
				retryable:  true,
				retryAfter: 35 * time.Millisecond,
			}
		}
		return nil
	})

	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("expected success on second attempt, got: %v", err)
	}
	if calls != 2 {
		t.Errorf("expected 2 calls, got %d", calls)
	}
	if elapsed < 30*time.Millisecond {
		t.Errorf("expected backoff at least 30ms due to Retry-After, got %v", elapsed)
	}
}

func TestParseRetryAfter(t *testing.T) {
	if dur := ParseRetryAfter("5"); dur != 5*time.Second {
		t.Errorf("expected 5s, got %v", dur)
	}
	if dur := ParseRetryAfter(""); dur != 0 {
		t.Errorf("expected 0 for empty, got %v", dur)
	}
	if dur := ParseRetryAfter("invalid"); dur != 0 {
		t.Errorf("expected 0 for invalid, got %v", dur)
	}
}
