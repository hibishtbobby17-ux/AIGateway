package main

import (
	"math"
	"sync"
	"time"
)

type RateLimitResult struct {
	Allowed       bool          `json:"allowed"`
	Limit         int           `json:"limit"`
	Remaining     int           `json:"remaining"`
	ResetDuration time.Duration `json:"reset_duration"`
	RetryAfter    time.Duration `json:"retry_after"`
}

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
	lastAccess time.Time
}

type TokenBucketLimiter struct {
	mu         sync.Mutex
	defaultRPM int
	burst      int
	keyTTL     time.Duration
	buckets    map[string]*tokenBucket
}

func NewTokenBucketLimiter(defaultRPM, burst int) *TokenBucketLimiter {
	if defaultRPM <= 0 {
		defaultRPM = 600 // 10 req/sec
	}
	if burst <= 0 {
		burst = defaultRPM / 10
		if burst < 10 {
			burst = 10
		}
	}

	limiter := &TokenBucketLimiter{
		defaultRPM: defaultRPM,
		burst:      burst,
		keyTTL:     10 * time.Minute,
		buckets:    make(map[string]*tokenBucket),
	}

	go limiter.startCleanupLoop()
	return limiter
}

func (l *TokenBucketLimiter) startCleanupLoop() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		l.mu.Lock()
		now := time.Now()
		for k, b := range l.buckets {
			if now.Sub(b.lastAccess) > l.keyTTL {
				delete(l.buckets, k)
			}
		}
		l.mu.Unlock()
	}
}

// Allow evaluates if a request with key should be permitted under the token bucket
func (l *TokenBucketLimiter) Allow(key string, customRPM int, customBurst int) RateLimitResult {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	rpm := l.defaultRPM
	if customRPM > 0 {
		rpm = customRPM
	}
	burst := l.burst
	if customBurst > 0 {
		burst = customBurst
	} else if customRPM > 0 {
		burst = customRPM / 10
		if burst < 5 {
			burst = 5
		}
	}

	b, exists := l.buckets[key]
	if !exists {
		b = &tokenBucket{
			tokens:     float64(burst),
			lastRefill: now,
			lastAccess: now,
		}
		l.buckets[key] = b
	}

	// Refill tokens based on elapsed duration
	elapsed := now.Sub(b.lastRefill).Seconds()
	fillRate := float64(rpm) / 60.0 // tokens per second
	b.tokens = math.Min(float64(burst), b.tokens+(elapsed*fillRate))
	b.lastRefill = now
	b.lastAccess = now

	// Check if at least 1 token is available
	if b.tokens >= 1.0 {
		b.tokens -= 1.0
		remaining := int(math.Floor(b.tokens))
		timeToFull := time.Duration((float64(burst)-b.tokens)/fillRate) * time.Second

		return RateLimitResult{
			Allowed:       true,
			Limit:         rpm,
			Remaining:     remaining,
			ResetDuration: timeToFull,
			RetryAfter:    0,
		}
	}

	// Rate limit exceeded: calculate retry-after duration
	deficit := 1.0 - b.tokens
	retryAfterSec := math.Ceil(deficit / fillRate)
	if retryAfterSec < 1.0 {
		retryAfterSec = 1.0
	}

	return RateLimitResult{
		Allowed:       false,
		Limit:         rpm,
		Remaining:     0,
		ResetDuration: time.Duration(float64(burst)/fillRate) * time.Second,
		RetryAfter:    time.Duration(retryAfterSec) * time.Second,
	}
}
