package main

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
)

type MetricsCollector struct {
	mu sync.RWMutex

	// Counters: key -> value
	requestsTotal        map[string]*int64
	requestDurationSum   map[string]*float64
	requestDurationCount map[string]*int64
	downstreamCalls      map[string]*int64
	rateLimitedTotal     map[string]*int64
	loadSheddingTotal    int64
	ssrfBlockedTotal     int64

	breakerRegistry *BreakerRegistry
	inFlightCounter *int64
}

func NewMetricsCollector(registry *BreakerRegistry, inFlight *int64) *MetricsCollector {
	return &MetricsCollector{
		requestsTotal:        make(map[string]*int64),
		requestDurationSum:   make(map[string]*float64),
		requestDurationCount: make(map[string]*int64),
		downstreamCalls:      make(map[string]*int64),
		rateLimitedTotal:     make(map[string]*int64),
		breakerRegistry:      registry,
		inFlightCounter:      inFlight,
	}
}

func (m *MetricsCollector) RecordRequest(project, method, status string, durationSec float64) {
	key := fmt.Sprintf(`project=%q,method=%q,status=%q`, project, method, status)

	m.mu.Lock()
	counter, ok := m.requestsTotal[key]
	if !ok {
		var val int64
		counter = &val
		m.requestsTotal[key] = counter
	}

	durKey := fmt.Sprintf(`project=%q,method=%q`, project, method)
	durSum, okSum := m.requestDurationSum[durKey]
	if !okSum {
		var d float64
		durSum = &d
		m.requestDurationSum[durKey] = durSum
	}
	durCount, okCount := m.requestDurationCount[durKey]
	if !okCount {
		var c int64
		durCount = &c
		m.requestDurationCount[durKey] = durCount
	}
	*durSum += durationSec
	*durCount++
	m.mu.Unlock()

	atomic.AddInt64(counter, 1)
}

func (m *MetricsCollector) RecordDownstreamCall(server, status string) {
	key := fmt.Sprintf(`server=%q,status=%q`, server, status)

	m.mu.Lock()
	counter, ok := m.downstreamCalls[key]
	if !ok {
		var val int64
		counter = &val
		m.downstreamCalls[key] = counter
	}
	m.mu.Unlock()

	atomic.AddInt64(counter, 1)
}

func (m *MetricsCollector) RecordRateLimited(project, client string) {
	key := fmt.Sprintf(`project=%q,client=%q`, project, client)

	m.mu.Lock()
	counter, ok := m.rateLimitedTotal[key]
	if !ok {
		var val int64
		counter = &val
		m.rateLimitedTotal[key] = counter
	}
	m.mu.Unlock()

	atomic.AddInt64(counter, 1)
}

func (m *MetricsCollector) RecordLoadShedding() {
	atomic.AddInt64(&m.loadSheddingTotal, 1)
}

func (m *MetricsCollector) RecordSSRFBlocked() {
	atomic.AddInt64(&m.ssrfBlockedTotal, 1)
}

func (m *MetricsCollector) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	m.mu.RLock()
	defer m.mu.RUnlock()

	// In-flight requests gauge
	var inFlightVal int64
	if m.inFlightCounter != nil {
		inFlightVal = atomic.LoadInt64(m.inFlightCounter)
	}
	fmt.Fprintf(w, "# HELP gateway_inflight_requests Current in-flight requests processed by gateway\n")
	fmt.Fprintf(w, "# TYPE gateway_inflight_requests gauge\n")
	fmt.Fprintf(w, "gateway_inflight_requests %d\n\n", inFlightVal)

	// Load shedding counter
	fmt.Fprintf(w, "# HELP gateway_load_shedding_total Total requests dropped due to concurrency limits\n")
	fmt.Fprintf(w, "# TYPE gateway_load_shedding_total counter\n")
	fmt.Fprintf(w, "gateway_load_shedding_total %d\n\n", atomic.LoadInt64(&m.loadSheddingTotal))

	// SSRF blocked counter
	fmt.Fprintf(w, "# HELP gateway_ssrf_blocked_total Total outbound requests blocked by SSRF guard\n")
	fmt.Fprintf(w, "# TYPE gateway_ssrf_blocked_total counter\n")
	fmt.Fprintf(w, "gateway_ssrf_blocked_total %d\n\n", atomic.LoadInt64(&m.ssrfBlockedTotal))

	// Requests total
	fmt.Fprintf(w, "# HELP gateway_requests_total Total incoming requests to the gateway\n")
	fmt.Fprintf(w, "# TYPE gateway_requests_total counter\n")
	for labels, counter := range m.requestsTotal {
		fmt.Fprintf(w, "gateway_requests_total{%s} %d\n", labels, atomic.LoadInt64(counter))
	}
	fmt.Fprintf(w, "\n")

	// Request durations
	fmt.Fprintf(w, "# HELP gateway_request_duration_seconds Total request processing latency in seconds\n")
	fmt.Fprintf(w, "# TYPE gateway_request_duration_seconds summary\n")
	for labels, sum := range m.requestDurationSum {
		count := m.requestDurationCount[labels]
		fmt.Fprintf(w, "gateway_request_duration_seconds_sum{%s} %f\n", labels, *sum)
		if count != nil {
			fmt.Fprintf(w, "gateway_request_duration_seconds_count{%s} %d\n", labels, *count)
		}
	}
	fmt.Fprintf(w, "\n")

	// Downstream calls
	fmt.Fprintf(w, "# HELP gateway_downstream_calls_total Total calls executed to downstream MCP servers\n")
	fmt.Fprintf(w, "# TYPE gateway_downstream_calls_total counter\n")
	for labels, counter := range m.downstreamCalls {
		fmt.Fprintf(w, "gateway_downstream_calls_total{%s} %d\n", labels, atomic.LoadInt64(counter))
	}
	fmt.Fprintf(w, "\n")

	// Rate limits
	fmt.Fprintf(w, "# HELP gateway_rate_limited_total Total requests rejected due to rate limiting\n")
	fmt.Fprintf(w, "# TYPE gateway_rate_limited_total counter\n")
	for labels, counter := range m.rateLimitedTotal {
		fmt.Fprintf(w, "gateway_rate_limited_total{%s} %d\n", labels, atomic.LoadInt64(counter))
	}
	fmt.Fprintf(w, "\n")

	// Circuit breakers state
	if m.breakerRegistry != nil {
		fmt.Fprintf(w, "# HELP gateway_circuit_breaker_state Current state of downstream circuit breaker (0=closed, 1=half-open, 2=open)\n")
		fmt.Fprintf(w, "# TYPE gateway_circuit_breaker_state gauge\n")
		for srv, state := range m.breakerRegistry.GetAllStates() {
			fmt.Fprintf(w, "gateway_circuit_breaker_state{server=%q} %d\n", srv, state)
		}
	}
}
