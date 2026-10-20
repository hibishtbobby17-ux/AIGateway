package resilience

import (
	"sync"
	"time"
)

// BreakerStats captures a snapshot of circuit breaker operational telemetry.
type BreakerStats struct {
	Name                string    `json:"name"`
	State               string    `json:"state"`
	FailureThreshold    int       `json:"failure_threshold"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
	TotalExecutions     int64     `json:"total_executions"`
	TotalFailures       int64     `json:"total_failures"`
	CooldownSeconds     float64   `json:"cooldown_seconds"`
	OpenedAt            time.Time `json:"opened_at,omitempty"`
}

// CircuitBreakerRegistry manages a collection of named circuit breakers across tenants and upstreams.
type CircuitBreakerRegistry struct {
	mu             sync.RWMutex
	breakers       map[string]*CircuitBreaker
	onStateChange  func(name string, from State, to State)
}

// NewCircuitBreakerRegistry creates a new circuit breaker registry.
func NewCircuitBreakerRegistry() *CircuitBreakerRegistry {
	return &CircuitBreakerRegistry{
		breakers: make(map[string]*CircuitBreaker),
	}
}

// SetStateChangeHook registers a global callback triggered on any breaker state transition.
func (r *CircuitBreakerRegistry) SetStateChangeHook(fn func(name string, from State, to State)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.onStateChange = fn
}

// GetOrCreate retrieves an existing circuit breaker or constructs one with the given parameters.
func (r *CircuitBreakerRegistry) GetOrCreate(name string, failureThreshold int, cooldown time.Duration) *CircuitBreaker {
	r.mu.RLock()
	cb, ok := r.breakers[name]
	r.mu.RUnlock()
	if ok {
		return cb
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Double-check under write lock
	if cb, ok := r.breakers[name]; ok {
		return cb
	}

	cb = NewCircuitBreaker(name, failureThreshold, cooldown)
	if r.onStateChange != nil {
		cb.SetStateChangeHook(r.onStateChange)
	}
	r.breakers[name] = cb
	return cb
}

// Get returns the circuit breaker registered under the given name, if present.
func (r *CircuitBreakerRegistry) Get(name string) (*CircuitBreaker, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cb, ok := r.breakers[name]
	return cb, ok
}

// GetAllStats returns a point-in-time snapshot of all registered circuit breakers.
func (r *CircuitBreakerRegistry) GetAllStats() map[string]BreakerStats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]BreakerStats, len(r.breakers))
	for name, cb := range r.breakers {
		result[name] = cb.Stats()
	}
	return result
}

// ResetAll resets all registered circuit breakers back to the CLOSED state.
func (r *CircuitBreakerRegistry) ResetAll() {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, cb := range r.breakers {
		cb.Reset()
	}
}
