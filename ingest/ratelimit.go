package main

import (
	"math"
	"sync"
	"time"
)

type IngestLimiter struct {
	mu         sync.Mutex
	defaultRPM int
	burst      int
	buckets    map[string]*tokenBucket
}

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

func NewIngestLimiter(defaultRPM, burst int) *IngestLimiter {
	if defaultRPM <= 0 {
		defaultRPM = 3000 // Ingest high throughput default (50 req/sec)
	}
	if burst <= 0 {
		burst = 50
	}
	return &IngestLimiter{
		defaultRPM: defaultRPM,
		burst:      burst,
		buckets:    make(map[string]*tokenBucket),
	}
}

func (l *IngestLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, ok := l.buckets[key]
	if !ok {
		b = &tokenBucket{
			tokens:     float64(l.burst),
			lastRefill: now,
		}
		l.buckets[key] = b
	}

	elapsed := now.Sub(b.lastRefill).Seconds()
	fillRate := float64(l.defaultRPM) / 60.0
	b.tokens = math.Min(float64(l.burst), b.tokens+(elapsed*fillRate))
	b.lastRefill = now

	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		return true, 0
	}

	retryAfter := time.Duration(math.Ceil((1.0-b.tokens)/fillRate)) * time.Second
	if retryAfter < 1*time.Second {
		retryAfter = 1 * time.Second
	}
	return false, retryAfter
}
