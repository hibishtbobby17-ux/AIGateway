package resilience

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// RateLimitResult reports the outcome of a rate limit check.
type RateLimitResult struct {
	Allowed       bool          `json:"allowed"`
	Limit         int           `json:"limit"`          // Max requests permitted per window
	Remaining     int           `json:"remaining"`      // Remaining tokens in current burst
	ResetDuration time.Duration `json:"reset_duration"` // Duration until bucket fully refills
	RetryAfter    time.Duration `json:"retry_after"`    // Time to wait before retrying (if rejected)
}

// bucket tracks token bucket state for a single rate-limited entity.
type bucket struct {
	tokens     float64
	lastRefill time.Time
	lastAccess time.Time
}

// RateLimiterConfig holds configuration for the token bucket rate limiter.
type RateLimiterConfig struct {
	RequestsPerMinute int           // Baseline rate limit per minute
	Burst             int           // Maximum burst capacity
	KeyTTL            time.Duration // Time after which inactive keys are pruned (default: 10m)
}

// RateLimiter implements an in-memory token bucket rate limiter with multi-tenant key isolation.
type RateLimiter struct {
	mu           sync.Mutex
	defaultRPM   int
	defaultBurst int
	keyTTL       time.Duration
	buckets      map[string]*bucket
	tierRPM      map[string]int // Optional RPM overrides by tier (e.g., standard: 600, enterprise: 6000)
}

// NewRateLimiter constructs a token bucket RateLimiter.
func NewRateLimiter(cfg RateLimiterConfig) *RateLimiter {
	rpm := cfg.RequestsPerMinute
	if rpm <= 0 {
		rpm = 600 // Default 600 req/min (10 req/sec)
	}
	burst := cfg.Burst
	if burst <= 0 {
		burst = rpm / 10
		if burst < 20 {
			burst = 20
		}
	}
	ttl := cfg.KeyTTL
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}

	rl := &RateLimiter{
		defaultRPM:   rpm,
		defaultBurst: burst,
		keyTTL:       ttl,
		buckets:      make(map[string]*bucket),
		tierRPM:      make(map[string]int),
	}

	return rl
}

// SetTierRPM configures a custom requests-per-minute threshold for a tenant tier.
func (rl *RateLimiter) SetTierRPM(tier string, rpm int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.tierRPM[tier] = rpm
}

// Allow checks whether a single request with cost 1 is allowed for the specified key.
func (rl *RateLimiter) Allow(key string) RateLimitResult {
	return rl.AllowN(key, 1, "")
}

// AllowN checks whether 'cost' requests are allowed for the given key and optional tenant tier.
func (rl *RateLimiter) AllowN(key string, cost int, tier string) RateLimitResult {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	rpm := rl.defaultRPM
	if tier != "" {
		if custom, ok := rl.tierRPM[tier]; ok && custom > 0 {
			rpm = custom
		}
	}

	burst := rl.defaultBurst
	if tier != "" && rpm != rl.defaultRPM {
		burst = rpm / 10
		if burst < 20 {
			burst = 20
		}
	}

	refillRatePerSec := float64(rpm) / 60.0

	b, exists := rl.buckets[key]
	if !exists {
		b = &bucket{
			tokens:     float64(burst),
			lastRefill: now,
			lastAccess: now,
		}
		rl.buckets[key] = b
	} else {
		// Refill tokens based on elapsed duration
		elapsed := now.Sub(b.lastRefill).Seconds()
		b.tokens = math.Min(float64(burst), b.tokens+(elapsed*refillRatePerSec))
		b.lastRefill = now
		b.lastAccess = now
	}

	res := RateLimitResult{
		Limit: rpm,
	}

	reqCost := float64(cost)
	if b.tokens >= reqCost {
		b.tokens -= reqCost
		res.Allowed = true
		res.Remaining = int(math.Floor(b.tokens))
		missingTokens := float64(burst) - b.tokens
		res.ResetDuration = time.Duration((missingTokens/refillRatePerSec)*float64(time.Second))
	} else {
		res.Allowed = false
		res.Remaining = 0
		deficit := reqCost - b.tokens
		neededSeconds := deficit / refillRatePerSec
		res.RetryAfter = time.Duration(math.Ceil(neededSeconds)) * time.Second
		if res.RetryAfter < time.Second {
			res.RetryAfter = time.Second
		}
		missingTokens := float64(burst) - b.tokens
		res.ResetDuration = time.Duration((missingTokens/refillRatePerSec)*float64(time.Second))
	}

	// Periodic cleanup of idle keys if map size grows large
	if len(rl.buckets) > 1000 {
		for k, v := range rl.buckets {
			if now.Sub(v.lastAccess) > rl.keyTTL {
				delete(rl.buckets, k)
			}
		}
	}

	return res
}

// RateLimitMiddleware returns an HTTP middleware enforcing rate limits.
func RateLimitMiddleware(limiter *RateLimiter, keyExtractor func(r *http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := "global"
			if keyExtractor != nil {
				key = keyExtractor(r)
			}
			if key == "" {
				key = "anonymous"
			}

			tier := r.Header.Get("X-Tenant-Tier")
			res := limiter.AllowN(key, 1, tier)

			// Standard rate limit response headers
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(res.Limit))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(res.Remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.Itoa(int(res.ResetDuration.Seconds())))

			if !res.Allowed {
				retryAfterSecs := int(math.Ceil(res.RetryAfter.Seconds()))
				if retryAfterSecs < 1 {
					retryAfterSecs = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(retryAfterSecs))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)

				_ = json.NewEncoder(w).Encode(map[string]any{
					"error":               "rate limit exceeded: too many requests",
					"retry_after_seconds": retryAfterSecs,
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// DefaultKeyExtractor builds a rate limit key prioritizing tenant ID and client IP.
func DefaultKeyExtractor(r *http.Request) string {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		tenantID = "default"
	}
	clientIP := r.RemoteAddr
	return fmt.Sprintf("tenant:%s:ip:%s", tenantID, clientIP)
}
