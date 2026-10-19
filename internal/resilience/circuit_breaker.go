package resilience

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrCircuitBreakerOpen     = errors.New("upstream circuit breaker is OPEN: fast-failing request")
	ErrConcurrencyLimitReached = errors.New("upstream bulkhead concurrency limit reached")
)

// State represents the circuit breaker state.
type State int

const (
	StateClosed State = iota
	StateHalfOpen
	StateOpen
)

func (s State) String() string {
	switch s {
	case StateClosed:
		return "CLOSED"
	case StateHalfOpen:
		return "HALF-OPEN"
	case StateOpen:
		return "OPEN"
	default:
		return "UNKNOWN"
	}
}

// CircuitBreaker manages fault tolerance and failure isolation for an upstream backend.
type CircuitBreaker struct {
	mu sync.Mutex

	name             string
	state            State
	failureThreshold int
	cooldown         time.Duration

	consecutiveFailures int
	openedAt            time.Time
}

// NewCircuitBreaker creates a circuit breaker with configurable thresholds.
func NewCircuitBreaker(name string, failureThreshold int, cooldown time.Duration) *CircuitBreaker {
	if failureThreshold <= 0 {
		failureThreshold = 5
	}
	if cooldown <= 0 {
		cooldown = 30 * time.Second
	}
	return &CircuitBreaker{
		name:             name,
		state:            StateClosed,
		failureThreshold: failureThreshold,
		cooldown:         cooldown,
	}
}

// Execute wraps an upstream operation in circuit breaker protection.
func (cb *CircuitBreaker) Execute(ctx context.Context, op func(ctx context.Context) error) error {
	cb.mu.Lock()

	now := time.Now()
	if cb.state == StateOpen {
		if now.Sub(cb.openedAt) >= cb.cooldown {
			// Cooldown elapsed: transition to Half-Open to probe upstream
			cb.state = StateHalfOpen
		} else {
			cb.mu.Unlock()
			return fmt.Errorf("%w for upstream %q", ErrCircuitBreakerOpen, cb.name)
		}
	}
	cb.mu.Unlock()

	// Execute operation
	err := op(ctx)

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.consecutiveFailures++
		if cb.consecutiveFailures >= cb.failureThreshold || cb.state == StateHalfOpen {
			cb.state = StateOpen
			cb.openedAt = time.Now()
		}
		return err
	}

	// Success
	if cb.state == StateHalfOpen || cb.consecutiveFailures > 0 {
		cb.state = StateClosed
		cb.consecutiveFailures = 0
	}
	return nil
}

// Bulkhead enforces strict bounded concurrency per upstream using semaphores.
type Bulkhead struct {
	sem chan struct{}
}

// NewBulkhead creates a bulkhead with a maximum concurrent capacity.
func NewBulkhead(limit int) *Bulkhead {
	if limit <= 0 {
		limit = 50
	}
	return &Bulkhead{
		sem: make(chan struct{}, limit),
	}
}

// Acquire reserves a concurrency slot or fails if limit reached / context canceled.
func (b *Bulkhead) Acquire(ctx context.Context) error {
	select {
	case b.sem <- struct{}{}:
		return nil
	default:
		select {
		case b.sem <- struct{}{}:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		default:
			return ErrConcurrencyLimitReached
		}
	}
}

// Release releases a reserved concurrency slot.
func (b *Bulkhead) Release() {
	select {
	case <-b.sem:
	default:
	}
}
