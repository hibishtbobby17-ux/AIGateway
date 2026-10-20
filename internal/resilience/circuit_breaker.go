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
	totalExecutions     int64
	totalFailures       int64
	openedAt            time.Time
	onStateChange       func(name string, from State, to State)
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

// SetStateChangeHook registers a callback invoked when the circuit breaker state changes.
func (cb *CircuitBreaker) SetStateChangeHook(fn func(name string, from State, to State)) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.onStateChange = fn
}

// State returns the current circuit breaker state.
func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

// Stats returns a snapshot of operational circuit breaker metrics.
func (cb *CircuitBreaker) Stats() BreakerStats {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return BreakerStats{
		Name:                cb.name,
		State:               cb.state.String(),
		FailureThreshold:    cb.failureThreshold,
		ConsecutiveFailures: cb.consecutiveFailures,
		TotalExecutions:     cb.totalExecutions,
		TotalFailures:       cb.totalFailures,
		CooldownSeconds:     cb.cooldown.Seconds(),
		OpenedAt:            cb.openedAt,
	}
}

// Reset resets the circuit breaker back to CLOSED state with 0 failures.
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	prev := cb.state
	cb.state = StateClosed
	cb.consecutiveFailures = 0
	if cb.onStateChange != nil && prev != StateClosed {
		cb.onStateChange(cb.name, prev, StateClosed)
	}
}

// Execute wraps an upstream operation in circuit breaker protection.
func (cb *CircuitBreaker) Execute(ctx context.Context, op func(ctx context.Context) error) error {
	cb.mu.Lock()

	now := time.Now()
	if cb.state == StateOpen {
		if now.Sub(cb.openedAt) >= cb.cooldown {
			// Cooldown elapsed: transition to Half-Open to probe upstream
			prev := cb.state
			cb.state = StateHalfOpen
			if cb.onStateChange != nil {
				cb.onStateChange(cb.name, prev, StateHalfOpen)
			}
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

	cb.totalExecutions++

	if err != nil {
		cb.totalFailures++
		cb.consecutiveFailures++
		if cb.consecutiveFailures >= cb.failureThreshold || cb.state == StateHalfOpen {
			prev := cb.state
			cb.state = StateOpen
			cb.openedAt = time.Now()
			if cb.onStateChange != nil && prev != StateOpen {
				cb.onStateChange(cb.name, prev, StateOpen)
			}
		}
		return err
	}

	// Success: close breaker if it was in HALF-OPEN or had failures
	if cb.state == StateHalfOpen || cb.consecutiveFailures > 0 {
		prev := cb.state
		cb.state = StateClosed
		cb.consecutiveFailures = 0
		if cb.onStateChange != nil && prev != StateClosed {
			cb.onStateChange(cb.name, prev, StateClosed)
		}
	}
	return nil
}

// Bulkhead enforces strict bounded concurrency per upstream using semaphores.
type Bulkhead struct {
	limit int
	sem   chan struct{}
}

// NewBulkhead creates a bulkhead with a maximum concurrent capacity.
func NewBulkhead(limit int) *Bulkhead {
	if limit <= 0 {
		limit = 50
	}
	return &Bulkhead{
		limit: limit,
		sem:   make(chan struct{}, limit),
	}
}

// Limit returns the maximum concurrency capacity of this bulkhead.
func (b *Bulkhead) Limit() int {
	return b.limit
}

// InFlight returns the number of currently active concurrent requests.
func (b *Bulkhead) InFlight() int {
	return len(b.sem)
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
