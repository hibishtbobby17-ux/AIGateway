package main

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestTokenBucketLimiter(t *testing.T) {
	// 60 RPM = 1 req/sec, burst = 3
	limiter := NewTokenBucketLimiter(60, 3)
	key := "test-client-1"

	// 1. First 3 requests (burst) should be allowed
	for i := 0; i < 3; i++ {
		res := limiter.Allow(key, 60, 3)
		if !res.Allowed {
			t.Fatalf("request %d should have been allowed within burst capacity", i+1)
		}
	}

	// 2. 4th request must be rejected
	res := limiter.Allow(key, 60, 3)
	if res.Allowed {
		t.Fatalf("4th request should have been rejected (burst exhausted)")
	}
	if res.RetryAfter <= 0 {
		t.Errorf("expected positive RetryAfter, got %v", res.RetryAfter)
	}

	// 3. Different client key should have its own bucket
	key2 := "test-client-2"
	res2 := limiter.Allow(key2, 60, 3)
	if !res2.Allowed {
		t.Fatalf("client 2 should have independent rate limit bucket")
	}
}

func TestCircuitBreakerTransitions(t *testing.T) {
	cb := NewCircuitBreaker("test-downstream", 3, 200*time.Millisecond)

	// Initially CLOSED
	if cb.State() != StateClosed {
		t.Fatalf("expected initial state CLOSED, got %s", cb.State())
	}
	if err := cb.Allow(); err != nil {
		t.Fatalf("expected Allow() to succeed when CLOSED, got: %v", err)
	}

	// Record 2 failures - should still be CLOSED
	cb.RecordFailure()
	cb.RecordFailure()
	if cb.State() != StateClosed {
		t.Fatalf("expected state CLOSED after 2 failures, got %s", cb.State())
	}

	// 3rd failure reaches threshold -> OPEN
	cb.RecordFailure()
	if cb.State() != StateOpen {
		t.Fatalf("expected state OPEN after 3 failures, got %s", cb.State())
	}

	// While OPEN, requests must fast-fail
	err := cb.Allow()
	if err == nil || !strings.Contains(err.Error(), "circuit breaker is OPEN") {
		t.Fatalf("expected ErrCircuitBreakerOpen, got: %v", err)
	}

	// Wait for cooldown to expire
	time.Sleep(250 * time.Millisecond)

	// Should transition to HALF-OPEN on next Allow()
	if err := cb.Allow(); err != nil {
		t.Fatalf("expected trial probe allowed in HALF-OPEN, got: %v", err)
	}

	// Concurrent callers during trial probe must be rejected
	if err := cb.Allow(); err == nil {
		t.Fatalf("expected rejection while trial probe is in flight")
	}

	// Probe succeeds -> transitions back to CLOSED
	cb.RecordSuccess()
	if cb.State() != StateClosed {
		t.Fatalf("expected state CLOSED after successful probe, got %s", cb.State())
	}
	if err := cb.Allow(); err != nil {
		t.Fatalf("expected Allow() to succeed after recovery, got: %v", err)
	}
}

func TestSSRFGuardValidation(t *testing.T) {
	// Cloud metadata (169.254.169.254) must ALWAYS be blocked, even if allowLocal=true
	errMetadata := ValidateURL("http://169.254.169.254/latest/meta-data/", true)
	if errMetadata == nil {
		t.Fatalf("expected SSRF error for AWS/GCP metadata IP 169.254.169.254")
	}

	// Private loopback IP when allowLocal=false must be blocked
	errLoopback := ValidateURL("http://127.0.0.1:8080/mcp", false)
	if errLoopback == nil {
		t.Fatalf("expected SSRF error for 127.0.0.1 when local egress is disabled")
	}

	// Private 10.x IP when allowLocal=false must be blocked
	errPrivate := ValidateURL("http://10.0.0.5:8080/mcp", false)
	if errPrivate == nil {
		t.Fatalf("expected SSRF error for private IP 10.0.0.5 when local egress is disabled")
	}

	// Loopback when allowLocal=true should be permitted (for local dev/tests)
	errLocalAllowed := ValidateURL("http://127.0.0.1:8080/mcp", true)
	if errLocalAllowed != nil {
		t.Fatalf("expected 127.0.0.1 to be permitted when allowLocal=true, got: %v", errLocalAllowed)
	}

	// Non-HTTP protocols must be blocked
	errFile := ValidateURL("file:///etc/passwd", true)
	if errFile == nil {
		t.Fatalf("expected file:// protocol to be rejected")
	}
}

func TestGatewayLoadShedding(t *testing.T) {
	tempFile, err := os.CreateTemp("", "test_loadshed_*.json")
	if err != nil {
		t.Fatalf("temp file error: %v", err)
	}
	defer os.Remove(tempFile.Name())

	gw := &Gateway{
		configPath:  tempFile.Name(),
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		maxInFlight: 1, // Only 1 concurrent request permitted
		maxBodySize: 1024 * 1024,
	}
	gw.loadLocalConfig()

	// Simulate 1 request currently in-flight
	atomic.StoreInt64(&gw.inFlight, 1)

	// Second concurrent request should be load-shed with 503
	req := httptest.NewRequest("POST", "/p/production/mcp", bytes.NewBuffer([]byte(`{"jsonrpc":"2.0","method":"ping","id":1}`)))
	req.SetPathValue("slug", "production")
	rec := httptest.NewRecorder()

	gw.handleMCP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable for load shedding, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("expected Retry-After header: 1, got %q", rec.Header().Get("Retry-After"))
	}
}

func TestGatewayRequestSizeLimit(t *testing.T) {
	tempFile, err := os.CreateTemp("", "test_size_*.json")
	if err != nil {
		t.Fatalf("temp file error: %v", err)
	}
	defer os.Remove(tempFile.Name())

	gw := &Gateway{
		configPath:  tempFile.Name(),
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		maxInFlight: 100,
		maxBodySize: 50, // Small 50 byte body cap
	}
	gw.loadLocalConfig()

	// Body exceeds 50 bytes
	hugePayload := bytes.Repeat([]byte("a"), 200)
	req := httptest.NewRequest("POST", "/p/production/mcp", bytes.NewBuffer(hugePayload))
	req.SetPathValue("slug", "production")
	rec := httptest.NewRecorder()

	gw.handleMCP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 Request Entity Too Large, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestGatewayPrometheusMetrics(t *testing.T) {
	breakers := NewBreakerRegistry()
	var inFlight int64 = 42
	collector := NewMetricsCollector(breakers, &inFlight)

	collector.RecordRequest("proj-alpha", "tools/call", "200", 0.015)
	collector.RecordDownstreamCall("srv-math", "200")
	collector.RecordRateLimited("proj-alpha", "client-1")
	collector.RecordLoadShedding()
	collector.RecordSSRFBlocked()

	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	collector.HandleMetrics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from /metrics, got %d", rec.Code)
	}

	body := rec.Body.String()
	expectedMetrics := []string{
		"gateway_inflight_requests 42",
		"gateway_load_shedding_total 1",
		"gateway_ssrf_blocked_total 1",
		"gateway_requests_total{project=\"proj-alpha\",method=\"tools/call\",status=\"200\"} 1",
		"gateway_downstream_calls_total{server=\"srv-math\",status=\"200\"} 1",
		"gateway_rate_limited_total{project=\"proj-alpha\",client=\"client-1\"} 1",
	}

	for _, metric := range expectedMetrics {
		if !strings.Contains(body, metric) {
			t.Errorf("missing expected metric line in /metrics: %q\nFull output:\n%s", metric, body)
		}
	}
}
