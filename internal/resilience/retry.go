package resilience

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ErrNonIdempotentOperation = errors.New("non-idempotent operation cannot be retried")
	ErrDeadlineExceededBudget = errors.New("insufficient time before deadline to execute retry")
)

// RetryableError is an optional interface that errors can implement to specify
// whether they can be retried and provide an optional Retry-After duration.
type RetryableError interface {
	error
	IsRetryable() bool
	RetryAfter() time.Duration
}

// RetryConfig defines the parameters for exponential backoff with full jitter.
type RetryConfig struct {
	MaxAttempts        int                                    // Maximum number of attempts (including initial)
	InitialBackoff     time.Duration                          // Base backoff duration (default: 100ms)
	MaxBackoff         time.Duration                          // Maximum cap on backoff duration (default: 3s)
	Multiplier         float64                                // Exponential growth factor (default: 2.0)
	FullJitter         bool                                   // Whether to randomize delay between 0 and backoff (default: true)
	RetryableChecker   func(error) bool                       // Custom error classification function
	OnRetry            func(attempt int, delay time.Duration, err error) // Callback on each retry attempt
}

// DefaultRetryConfig returns a production-ready retry configuration.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:    3,
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     3 * time.Second,
		Multiplier:     2.0,
		FullJitter:     true,
	}
}

// Retrier executes operations with exponential backoff, jitter, and strict idempotency enforcement.
type Retrier struct {
	cfg RetryConfig
	rng *rand.Rand
	mu  sync.Mutex
}

// NewRetrier creates a new Retrier instance with the given configuration.
func NewRetrier(cfg RetryConfig) *Retrier {
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 3
	}
	if cfg.InitialBackoff <= 0 {
		cfg.InitialBackoff = 100 * time.Millisecond
	}
	if cfg.MaxBackoff <= 0 {
		cfg.MaxBackoff = 3 * time.Second
	}
	if cfg.Multiplier <= 1.0 {
		cfg.Multiplier = 2.0
	}

	return &Retrier{
		cfg: cfg,
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Execute wraps an operation in retry logic. If isIdempotent is false, the operation
// is executed at most once, strictly preserving ADR-0008 safety invariants.
func (r *Retrier) Execute(ctx context.Context, isIdempotent bool, op func(ctx context.Context) error) error {
	maxAttempts := r.cfg.MaxAttempts
	if !isIdempotent {
		maxAttempts = 1
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		lastErr = op(ctx)
		if lastErr == nil {
			return nil
		}

		// If this is the last allowed attempt or operation is non-idempotent, return error immediately
		if attempt >= maxAttempts-1 || !isIdempotent {
			break
		}

		// Check if the error is considered retryable
		if !r.isRetryable(lastErr) {
			break
		}

		// Compute backoff duration with full jitter and check upstream Retry-After
		delay := r.computeBackoff(attempt, lastErr)

		// Deadline awareness: verify if sufficient time remains before context deadline
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining <= delay {
				// Abort retry loop: sleeping would guarantee a context deadline exceeded error
				return fmt.Errorf("%w: remaining %v, needed %v (last error: %v)", ErrDeadlineExceededBudget, remaining, delay, lastErr)
			}
		}

		if r.cfg.OnRetry != nil {
			r.cfg.OnRetry(attempt+1, delay, lastErr)
		}

		// Await backoff or context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}

	return lastErr
}

// computeBackoff calculates the backoff duration for the given attempt.
func (r *Retrier) computeBackoff(attempt int, err error) time.Duration {
	// 1. Check if error specifies an explicit Retry-After
	if re, ok := err.(RetryableError); ok {
		if after := re.RetryAfter(); after > 0 {
			if after > r.cfg.MaxBackoff {
				return r.cfg.MaxBackoff
			}
			return after
		}
	}

	// 2. Exponential backoff: base * (multiplier ^ attempt)
	backoff := float64(r.cfg.InitialBackoff)
	for i := 0; i < attempt; i++ {
		backoff *= r.cfg.Multiplier
		if backoff > float64(r.cfg.MaxBackoff) {
			backoff = float64(r.cfg.MaxBackoff)
			break
		}
	}

	if !r.cfg.FullJitter {
		return time.Duration(backoff)
	}

	// 3. Full Jitter: uniform random value in [0, backoff]
	r.mu.Lock()
	factor := r.rng.Float64()
	r.mu.Unlock()

	jittered := time.Duration(backoff * factor)
	if jittered < 10*time.Millisecond {
		jittered = 10 * time.Millisecond
	}
	return jittered
}

// isRetryable evaluates whether an error qualifies for retry.
func (r *Retrier) isRetryable(err error) bool {
	if err == nil {
		return false
	}

	// Context cancellation or expiration is never retryable
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	if r.cfg.RetryableChecker != nil {
		return r.cfg.RetryableChecker(err)
	}

	// Check RetryableError interface
	if re, ok := err.(RetryableError); ok {
		return re.IsRetryable()
	}

	// Standard network errors: timeouts, temporary, connection reset, broken pipe
	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return true
		}
	}

	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "eof") ||
		strings.Contains(msg, "502") ||
		strings.Contains(msg, "503") ||
		strings.Contains(msg, "504") ||
		strings.Contains(msg, "429") {
		return true
	}

	return false
}

// ParseRetryAfter parses HTTP Retry-After headers in seconds or RFC1123 HTTP-date format.
func ParseRetryAfter(header string) time.Duration {
	if header == "" {
		return 0
	}
	// Try integer seconds
	if secs, err := strconv.Atoi(strings.TrimSpace(header)); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	// Try RFC1123 date
	if t, err := http.ParseTime(header); err == nil {
		diff := time.Until(t)
		if diff > 0 {
			return diff
		}
	}
	return 0
}
