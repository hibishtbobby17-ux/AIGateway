package resilience

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// DefaultMaxRequestBodySize is 10 Megabytes.
const DefaultMaxRequestBodySize int64 = 10 * 1024 * 1024

// MaxBytesMiddleware wraps the request body with http.MaxBytesReader to enforce a strict
// bound on inbound request payload sizes, protecting against memory exhaustion attacks.
func MaxBytesMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxRequestBodySize
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Fast-check Content-Length header if provided
			if r.ContentLength > maxBytes {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error":            fmt.Sprintf("request payload size (%d bytes) exceeds maximum limit of %d bytes", r.ContentLength, maxBytes),
					"status_code":      http.StatusRequestEntityTooLarge,
					"max_bytes_limit": maxBytes,
				})
				return
			}

			// Wrap body to guard against unannounced or chunked streaming attacks
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

// IsMaxBytesError checks if an error was caused by exceeding http.MaxBytesReader limit.
func IsMaxBytesError(err error) bool {
	if err == nil {
		return false
	}
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}
