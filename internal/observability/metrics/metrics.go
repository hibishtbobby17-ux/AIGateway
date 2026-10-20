package metrics

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// MetricType represents Prometheus metric types.
type MetricType string

const (
	TypeCounter   MetricType = "counter"
	TypeGauge     MetricType = "gauge"
	TypeHistogram MetricType = "histogram"
)

// Standard latency histogram buckets (in seconds).
var defaultBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0}

// Counter tracks monotonically increasing values with label sets.
type Counter struct {
	mu     sync.RWMutex
	values map[string]*uint64
}

func newCounter() *Counter {
	return &Counter{values: make(map[string]*uint64)}
}

// Inc increments the counter by 1 for the given labels.
func (c *Counter) Inc(labels map[string]string) {
	c.Add(1, labels)
}

// Add adds a positive delta to the counter.
func (c *Counter) Add(delta uint64, labels map[string]string) {
	key := labelsToKey(labels)
	c.mu.RLock()
	ptr, ok := c.values[key]
	c.mu.RUnlock()
	if ok {
		atomic.AddUint64(ptr, delta)
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if ptr, ok = c.values[key]; ok {
		atomic.AddUint64(ptr, delta)
		return
	}
	val := delta
	c.values[key] = &val
}

// Gauge tracks a value that can increase and decrease.
type Gauge struct {
	mu     sync.RWMutex
	values map[string]*int64
}

func newGauge() *Gauge {
	return &Gauge{values: make(map[string]*int64)}
}

// Set sets the gauge value.
func (g *Gauge) Set(val int64, labels map[string]string) {
	key := labelsToKey(labels)
	g.mu.Lock()
	defer g.mu.Unlock()
	g.values[key] = &val
}

// Histogram tracks frequency distributions of values with standard buckets.
type Histogram struct {
	mu      sync.RWMutex
	buckets []float64
	counts  map[string][]uint64
	sums    map[string]float64
	totals  map[string]uint64
}

func newHistogram(buckets []float64) *Histogram {
	if len(buckets) == 0 {
		buckets = defaultBuckets
	}
	sorted := make([]float64, len(buckets))
	copy(sorted, buckets)
	sort.Float64s(sorted)
	return &Histogram{
		buckets: sorted,
		counts:  make(map[string][]uint64),
		sums:    make(map[string]float64),
		totals:  make(map[string]uint64),
	}
}

// Observe records a float observation (such as request duration in seconds).
func (h *Histogram) Observe(val float64, labels map[string]string) {
	key := labelsToKey(labels)
	h.mu.Lock()
	defer h.mu.Unlock()

	bCounts, ok := h.counts[key]
	if !ok {
		bCounts = make([]uint64, len(h.buckets))
		h.counts[key] = bCounts
	}

	for i, b := range h.buckets {
		if val <= b {
			bCounts[i]++
		}
	}
	h.sums[key] += val
	h.totals[key]++
}

// Registry manages and serializes Prometheus metrics.
type Registry struct {
	mu         sync.RWMutex
	counters   map[string]*counterEntry
	gauges     map[string]*gaugeEntry
	histograms map[string]*histogramEntry
}

type counterEntry struct {
	help    string
	counter *Counter
}

type gaugeEntry struct {
	help  string
	gauge *Gauge
}

type histogramEntry struct {
	help      string
	histogram *Histogram
}

// NewRegistry creates a new metrics Registry.
func NewRegistry() *Registry {
	return &Registry{
		counters:   make(map[string]*counterEntry),
		gauges:     make(map[string]*gaugeEntry),
		histograms: make(map[string]*histogramEntry),
	}
}

// RegisterCounter registers a counter with name and help string.
func (r *Registry) RegisterCounter(name, help string) *Counter {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.counters[name]; ok {
		return entry.counter
	}
	c := newCounter()
	r.counters[name] = &counterEntry{help: help, counter: c}
	return c
}

// RegisterGauge registers a gauge with name and help string.
func (r *Registry) RegisterGauge(name, help string) *Gauge {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.gauges[name]; ok {
		return entry.gauge
	}
	g := newGauge()
	r.gauges[name] = &gaugeEntry{help: help, gauge: g}
	return g
}

// RegisterHistogram registers a histogram with name and help string.
func (r *Registry) RegisterHistogram(name, help string, buckets []float64) *Histogram {
	r.mu.Lock()
	defer r.mu.Unlock()
	if entry, ok := r.histograms[name]; ok {
		return entry.histogram
	}
	h := newHistogram(buckets)
	r.histograms[name] = &histogramEntry{help: help, histogram: h}
	return h
}

// Handler returns an http.Handler that renders metrics in standard Prometheus text format.
func (r *Registry) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.WriteHeader(http.StatusOK)

		r.mu.RLock()
		defer r.mu.RUnlock()

		var b strings.Builder

		// 1. Counters
		for name, entry := range r.counters {
			b.WriteString(fmt.Sprintf("# HELP %s %s\n", name, entry.help))
			b.WriteString(fmt.Sprintf("# TYPE %s counter\n", name))
			entry.counter.mu.RLock()
			for lKey, ptr := range entry.counter.values {
				b.WriteString(fmt.Sprintf("%s%s %d\n", name, formatLabels(lKey), atomic.LoadUint64(ptr)))
			}
			entry.counter.mu.RUnlock()
		}

		// 2. Gauges
		for name, entry := range r.gauges {
			b.WriteString(fmt.Sprintf("# HELP %s %s\n", name, entry.help))
			b.WriteString(fmt.Sprintf("# TYPE %s gauge\n", name))
			entry.gauge.mu.RLock()
			for lKey, ptr := range entry.gauge.values {
				b.WriteString(fmt.Sprintf("%s%s %d\n", name, formatLabels(lKey), *ptr))
			}
			entry.gauge.mu.RUnlock()
		}

		// 3. Histograms
		for name, entry := range r.histograms {
			b.WriteString(fmt.Sprintf("# HELP %s %s\n", name, entry.help))
			b.WriteString(fmt.Sprintf("# TYPE %s histogram\n", name))
			h := entry.histogram
			h.mu.RLock()
			for lKey, bCounts := range h.counts {
				labels := parseKeyToLabels(lKey)
				for i, bucket := range h.buckets {
					lbls := copyMap(labels)
					lbls["le"] = fmt.Sprintf("%g", bucket)
					b.WriteString(fmt.Sprintf("%s_bucket{%s} %d\n", name, mapToPromString(lbls), bCounts[i]))
				}
				lblsInf := copyMap(labels)
				lblsInf["le"] = "+Inf"
				b.WriteString(fmt.Sprintf("%s_bucket{%s} %d\n", name, mapToPromString(lblsInf), h.totals[lKey]))
				b.WriteString(fmt.Sprintf("%s_sum%s %g\n", name, formatLabels(lKey), h.sums[lKey]))
				b.WriteString(fmt.Sprintf("%s_count%s %d\n", name, formatLabels(lKey), h.totals[lKey]))
			}
			h.mu.RUnlock()
		}

		_, _ = w.Write([]byte(b.String()))
	}
}

func labelsToKey(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = fmt.Sprintf("%s=%s", k, labels[k])
	}
	return strings.Join(parts, ",")
}

func parseKeyToLabels(key string) map[string]string {
	res := make(map[string]string)
	if key == "" {
		return res
	}
	pairs := strings.Split(key, ",")
	for _, p := range pairs {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) == 2 {
			res[kv[0]] = kv[1]
		}
	}
	return res
}

func formatLabels(key string) string {
	if key == "" {
		return ""
	}
	labels := parseKeyToLabels(key)
	return "{" + mapToPromString(labels) + "}"
}

func mapToPromString(labels map[string]string) string {
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = fmt.Sprintf("%s=%q", k, labels[k])
	}
	return strings.Join(parts, ",")
}

func copyMap(m map[string]string) map[string]string {
	res := make(map[string]string, len(m)+1)
	for k, v := range m {
		res[k] = v
	}
	return res
}

// GatewayMetrics holds platform-wide metrics handles.
type GatewayMetrics struct {
	Registry           *Registry
	RequestsTotal      *Counter
	RequestDuration    *Histogram
	ToolCallsTotal     *Counter
	ToolDuration       *Histogram
	TasksTotal         *Counter
	TaskDuration       *Histogram
	TelemetryIngested  *Counter
	TelemetryDropped   *Counter
	ActiveConnections  *Gauge
}

// NewGatewayMetrics initializes all core gateway metrics.
func NewGatewayMetrics(reg *Registry) *GatewayMetrics {
	if reg == nil {
		reg = NewRegistry()
	}
	return &GatewayMetrics{
		Registry: reg,
		RequestsTotal: reg.RegisterCounter("gateway_requests_total",
			"Total number of HTTP requests processed by the gateway"),
		RequestDuration: reg.RegisterHistogram("gateway_request_duration_seconds",
			"HTTP request latency distributions across gateway endpoints", defaultBuckets),
		ToolCallsTotal: reg.RegisterCounter("mcp_tool_calls_total",
			"Total number of MCP tool invocations"),
		ToolDuration: reg.RegisterHistogram("mcp_tool_duration_seconds",
			"MCP tool invocation duration in seconds", defaultBuckets),
		TasksTotal: reg.RegisterCounter("a2a_tasks_total",
			"Total number of A2A agent tasks processed"),
		TaskDuration: reg.RegisterHistogram("a2a_task_duration_seconds",
			"A2A task execution duration in seconds", defaultBuckets),
		TelemetryIngested: reg.RegisterCounter("telemetry_ingested_total",
			"Total number of telemetry items ingested into pipeline"),
		TelemetryDropped: reg.RegisterCounter("telemetry_dropped_total",
			"Total number of telemetry items dropped due to buffer capacity or load shedding"),
		ActiveConnections: reg.RegisterGauge("active_connections",
			"Number of currently active streaming connections"),
	}
}

// RecordRequest captures latency and status for an HTTP request.
func (gm *GatewayMetrics) RecordRequest(method, path, status, tenantID string, duration time.Duration) {
	labels := map[string]string{
		"method": method,
		"path":   path,
		"status": status,
		"tenant": tenantID,
	}
	gm.RequestsTotal.Inc(labels)
	gm.RequestDuration.Observe(duration.Seconds(), labels)
}
