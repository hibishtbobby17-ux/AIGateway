package resilience

import (
	"sync"
)

// BulkheadStats captures a snapshot of bulkhead capacity and in-flight telemetry.
type BulkheadStats struct {
	Name     string `json:"name"`
	Limit    int    `json:"limit"`
	InFlight int    `json:"in_flight"`
}

// BulkheadRegistry coordinates bounded concurrency isolation across upstreams.
type BulkheadRegistry struct {
	mu        sync.RWMutex
	bulkheads map[string]*Bulkhead
}

// NewBulkheadRegistry creates a new bulkhead registry.
func NewBulkheadRegistry() *BulkheadRegistry {
	return &BulkheadRegistry{
		bulkheads: make(map[string]*Bulkhead),
	}
}

// GetOrCreate retrieves an existing bulkhead or creates one with the configured limit.
func (r *BulkheadRegistry) GetOrCreate(name string, limit int) *Bulkhead {
	r.mu.RLock()
	bh, ok := r.bulkheads[name]
	r.mu.RUnlock()
	if ok {
		return bh
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if bh, ok := r.bulkheads[name]; ok {
		return bh
	}

	bh = NewBulkhead(limit)
	r.bulkheads[name] = bh
	return bh
}

// Get returns the bulkhead for a specific upstream if registered.
func (r *BulkheadRegistry) Get(name string) (*Bulkhead, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	bh, ok := r.bulkheads[name]
	return bh, ok
}

// GetAllStats returns the current in-flight and capacity snapshot for all bulkheads.
func (r *BulkheadRegistry) GetAllStats() map[string]BulkheadStats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]BulkheadStats, len(r.bulkheads))
	for name, bh := range r.bulkheads {
		result[name] = BulkheadStats{
			Name:     name,
			Limit:    bh.Limit(),
			InFlight: bh.InFlight(),
		}
	}
	return result
}
