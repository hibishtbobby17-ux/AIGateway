package main

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrCircuitBreakerOpen = errors.New("circuit breaker is OPEN: downstream server is failing, fast-failing request")
)

type BreakerState int

const (
	StateClosed BreakerState = iota
	StateHalfOpen
	StateOpen
)

func (s BreakerState) String() string {
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

type CircuitBreaker struct {
	mu                  sync.Mutex
	name                string
	state               BreakerState
	failureThreshold    int
	cooldown            time.Duration
	consecutiveFailures int
	openedAt            time.Time
	halfOpenInFlight    bool
}

func NewCircuitBreaker(name string, failureThreshold int, cooldown time.Duration) *CircuitBreaker {
	if failureThreshold <= 0 {
		failureThreshold = 5
	}
	if cooldown <= 0 {
		cooldown = 10 * time.Second
	}
	return &CircuitBreaker{
		name:             name,
		state:            StateClosed,
		failureThreshold: failureThreshold,
		cooldown:         cooldown,
	}
}

func (cb *CircuitBreaker) Allow() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	now := time.Now()

	switch cb.state {
	case StateClosed:
		return nil

	case StateOpen:
		if now.Sub(cb.openedAt) >= cb.cooldown {
			// Cooldown expired: transition to Half-Open to probe downstream
			cb.state = StateHalfOpen
			cb.halfOpenInFlight = true
			return nil
		}
		return fmt.Errorf("%w for server %s (cooldown remaining: %v)", ErrCircuitBreakerOpen, cb.name, cb.cooldown-now.Sub(cb.openedAt).Round(time.Millisecond))

	case StateHalfOpen:
		if !cb.halfOpenInFlight {
			cb.halfOpenInFlight = true
			return nil
		}
		// Probe already in-flight: reject other callers
		return fmt.Errorf("%w for server %s (trial probe in progress)", ErrCircuitBreakerOpen, cb.name)

	default:
		return nil
	}
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.consecutiveFailures = 0
	cb.state = StateClosed
	cb.halfOpenInFlight = false
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.consecutiveFailures++
	cb.halfOpenInFlight = false

	if cb.state == StateHalfOpen || cb.consecutiveFailures >= cb.failureThreshold {
		cb.state = StateOpen
		cb.openedAt = time.Now()
	}
}

func (cb *CircuitBreaker) State() BreakerState {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// Automatically report half-open if cooldown passed while in open state
	if cb.state == StateOpen && time.Since(cb.openedAt) >= cb.cooldown {
		return StateHalfOpen
	}
	return cb.state
}

// BreakerRegistry maintains circuit breakers per downstream server
type BreakerRegistry struct {
	mu       sync.RWMutex
	breakers map[string]*CircuitBreaker
}

func NewBreakerRegistry() *BreakerRegistry {
	return &BreakerRegistry{
		breakers: make(map[string]*CircuitBreaker),
	}
}

func (r *BreakerRegistry) Get(serverID string) *CircuitBreaker {
	r.mu.RLock()
	cb, ok := r.breakers[serverID]
	r.mu.RUnlock()
	if ok {
		return cb
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	cb, ok = r.breakers[serverID]
	if !ok {
		cb = NewCircuitBreaker(serverID, 5, 10*time.Second)
		r.breakers[serverID] = cb
	}
	return cb
}

func (r *BreakerRegistry) GetAllStates() map[string]int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	states := make(map[string]int)
	for id, cb := range r.breakers {
		states[id] = int(cb.State())
	}
	return states
}
