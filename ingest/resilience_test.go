package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIngestRateLimiter(t *testing.T) {
	// 60 RPM, burst 2
	limiter := NewIngestLimiter(60, 2)
	key := "ingest-key-1"

	// 1 & 2 allowed
	if ok, _ := limiter.Allow(key); !ok {
		t.Fatalf("first request should be allowed")
	}
	if ok, _ := limiter.Allow(key); !ok {
		t.Fatalf("second request should be allowed (burst)")
	}

	// 3rd rejected
	if ok, retry := limiter.Allow(key); ok {
		t.Fatalf("third request should be rate limited")
	} else if retry <= 0 {
		t.Errorf("expected positive retry duration, got %v", retry)
	}
}

func TestIngestMetricsHandler(t *testing.T) {
	metrics := NewIngestMetrics()
	metrics.IncReceived(10)
	metrics.IncPersisted(8)
	metrics.IncRateLimited()
	metrics.AddBytes(2048)

	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	metrics.HandleMetrics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	body := rec.Body.String()
	expected := []string{
		"ingest_events_received_total 10",
		"ingest_events_persisted_total 8",
		"ingest_rate_limited_total 1",
		"ingest_payload_bytes_total 2048",
	}

	for _, line := range expected {
		if !strings.Contains(body, line) {
			t.Errorf("expected metric %q in output:\n%s", line, body)
		}
	}
}
