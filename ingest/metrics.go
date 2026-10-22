package main

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

type IngestMetrics struct {
	eventsReceivedTotal  int64
	eventsPersistedTotal int64
	rateLimitedTotal     int64
	payloadBytesTotal    int64
}

func NewIngestMetrics() *IngestMetrics {
	return &IngestMetrics{}
}

func (m *IngestMetrics) IncReceived(count int64) {
	atomic.AddInt64(&m.eventsReceivedTotal, count)
}

func (m *IngestMetrics) IncPersisted(count int64) {
	atomic.AddInt64(&m.eventsPersistedTotal, count)
}

func (m *IngestMetrics) IncRateLimited() {
	atomic.AddInt64(&m.rateLimitedTotal, 1)
}

func (m *IngestMetrics) AddBytes(bytes int64) {
	atomic.AddInt64(&m.payloadBytesTotal, bytes)
}

func (m *IngestMetrics) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	fmt.Fprintf(w, "# HELP ingest_events_received_total Total telemetry events received by ingest endpoint\n")
	fmt.Fprintf(w, "# TYPE ingest_events_received_total counter\n")
	fmt.Fprintf(w, "ingest_events_received_total %d\n\n", atomic.LoadInt64(&m.eventsReceivedTotal))

	fmt.Fprintf(w, "# HELP ingest_events_persisted_total Total telemetry events successfully persisted into log stores\n")
	fmt.Fprintf(w, "# TYPE ingest_events_persisted_total counter\n")
	fmt.Fprintf(w, "ingest_events_persisted_total %d\n\n", atomic.LoadInt64(&m.eventsPersistedTotal))

	fmt.Fprintf(w, "# HELP ingest_rate_limited_total Total requests rejected due to rate limits\n")
	fmt.Fprintf(w, "# TYPE ingest_rate_limited_total counter\n")
	fmt.Fprintf(w, "ingest_rate_limited_total %d\n\n", atomic.LoadInt64(&m.rateLimitedTotal))

	fmt.Fprintf(w, "# HELP ingest_payload_bytes_total Total payload bytes processed by ingest service\n")
	fmt.Fprintf(w, "# TYPE ingest_payload_bytes_total counter\n")
	fmt.Fprintf(w, "ingest_payload_bytes_total %d\n\n", atomic.LoadInt64(&m.payloadBytesTotal))
}
