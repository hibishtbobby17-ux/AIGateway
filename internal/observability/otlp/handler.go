package otlp

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"project_alpha/internal/identity/principal"
	"project_alpha/internal/observability/model"
	"project_alpha/internal/observability/pipeline"
)

// IngestionHandler handles standard OTLP/HTTP JSON telemetry exports.
type IngestionHandler struct {
	pipeline        *pipeline.Pipeline
	defaultTenantID string
}

// NewIngestionHandler creates a new OTLP IngestionHandler.
func NewIngestionHandler(pipe *pipeline.Pipeline, defaultTenantID string) *IngestionHandler {
	if defaultTenantID == "" {
		defaultTenantID = "default"
	}
	return &IngestionHandler{
		pipeline:        pipe,
		defaultTenantID: defaultTenantID,
	}
}

// Mount mounts the standard OTLP/HTTP export routes on the given mux.
func (h *IngestionHandler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("/v1/traces", h.HandleTraces)
	mux.HandleFunc("/v1/logs", h.HandleLogs)
	mux.HandleFunc("/v1/metrics", h.HandleMetrics)
}

// HandleTraces receives OTLP/HTTP ExportTraceServiceRequest JSON payloads.
func (h *IngestionHandler) HandleTraces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed: must be POST", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2*1024*1024))
	if err != nil {
		writeOTLPError(w, http.StatusBadRequest, "payload too large or unreadable")
		return
	}

	var req otlpTraceRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeOTLPError(w, http.StatusBadRequest, "invalid OTLP trace JSON: "+err.Error())
		return
	}

	tenantID := h.extractTenantID(r)

	// Transform OTLP spans to domain spans
	for _, rs := range req.ResourceSpans {
		resAttrs := parseOTLPAttributes(rs.Resource.Attributes)
		resTenant := tenantID
		if val, ok := resAttrs["tenant.id"].(string); ok && val != "" {
			resTenant = val
		}

		for _, ss := range rs.ScopeSpans {
			for _, s := range ss.Spans {
				spanAttrs := parseOTLPAttributes(s.Attributes)
				for k, v := range resAttrs {
					spanAttrs[k] = v
				}

				start := parseNanoTime(s.StartTimeUnixNano)
				end := parseNanoTime(s.EndTimeUnixNano)
				durationMs := float64(end.Sub(start).Microseconds()) / 1000.0

				statusCode := model.StatusCodeOk
				if s.Status.Code == 2 {
					statusCode = model.StatusCodeError
				}

				domainSpan := &model.Span{
					SpanID:        cleanHex(s.SpanID),
					TraceID:       cleanHex(s.TraceID),
					ParentSpanID:  cleanHex(s.ParentSpanID),
					TenantID:      resTenant,
					Name:          s.Name,
					Kind:          otlpKindToString(s.Kind),
					StartTime:     start,
					EndTime:       end,
					DurationMs:    durationMs,
					StatusCode:    statusCode,
					StatusMessage: s.Status.Message,
					Attributes:    spanAttrs,
				}

				// Push to non-blocking ring buffer
				h.pipeline.EnqueueSpan(domainSpan)
			}
		}
	}

	writeOTLPSuccess(w)
}

// HandleLogs receives OTLP/HTTP ExportLogsServiceRequest JSON payloads.
func (h *IngestionHandler) HandleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed: must be POST", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2*1024*1024))
	if err != nil {
		writeOTLPError(w, http.StatusBadRequest, "payload too large or unreadable")
		return
	}

	var req otlpLogRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeOTLPError(w, http.StatusBadRequest, "invalid OTLP log JSON: "+err.Error())
		return
	}

	tenantID := h.extractTenantID(r)

	for _, rl := range req.ResourceLogs {
		resAttrs := parseOTLPAttributes(rl.Resource.Attributes)
		resTenant := tenantID
		if val, ok := resAttrs["tenant.id"].(string); ok && val != "" {
			resTenant = val
		}

		for _, sl := range rl.ScopeLogs {
			for _, lr := range sl.LogRecords {
				logAttrs := parseOTLPAttributes(lr.Attributes)
				for k, v := range resAttrs {
					logAttrs[k] = v
				}

				timestamp := parseNanoTime(lr.TimeUnixNano)
				if timestamp.IsZero() {
					timestamp = time.Now().UTC()
				}

				msg := lr.Body.StringValue
				if msg == "" && lr.Body.Value != nil {
					msg = fmt.Sprintf("%v", lr.Body.Value)
				}

				severity := lr.SeverityText
				if severity == "" {
					severity = "INFO"
				}

				id := cleanHex(lr.SpanID)
				if id == "" {
					id = fmt.Sprintf("log-%d", timestamp.UnixNano())
				}

				domainLog := &model.LogRecord{
					ID:         id,
					TenantID:   resTenant,
					TraceID:    cleanHex(lr.TraceID),
					SpanID:     cleanHex(lr.SpanID),
					Severity:   strings.ToUpper(severity),
					Message:    msg,
					Attributes: logAttrs,
					Timestamp:  timestamp,
				}

				h.pipeline.EnqueueLog(domainLog)
			}
		}
	}

	writeOTLPSuccess(w)
}

// HandleMetrics accepts standard OTLP/HTTP ExportMetricsServiceRequest JSON payloads.
func (h *IngestionHandler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed: must be POST", http.StatusMethodNotAllowed)
		return
	}
	// Acknowledge receipt
	writeOTLPSuccess(w)
}

func (h *IngestionHandler) extractTenantID(r *http.Request) string {
	if p, ok := principal.FromContext(r.Context()); ok && p.TenantID != "" {
		return p.TenantID
	}
	if tid := r.Header.Get("X-Tenant-ID"); tid != "" {
		return tid
	}
	return h.defaultTenantID
}

func writeOTLPSuccess(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"partialSuccess":{}}`))
}

func writeOTLPError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": msg,
		"code":  status,
	})
}

func parseNanoTime(nanoStr any) time.Time {
	switch v := nanoStr.(type) {
	case string:
		n, err := strconv.ParseInt(v, 10, 64)
		if err == nil && n > 0 {
			return time.Unix(0, n).UTC()
		}
	case float64:
		return time.Unix(0, int64(v)).UTC()
	}
	return time.Now().UTC()
}

func cleanHex(input string) string {
	clean := strings.TrimSpace(input)
	if _, err := hex.DecodeString(clean); err == nil && len(clean) > 0 {
		return clean
	}
	return input
}

func otlpKindToString(k int) string {
	switch k {
	case 1:
		return model.SpanKindInternal
	case 2:
		return model.SpanKindServer
	case 3:
		return model.SpanKindClient
	case 4:
		return model.SpanKindProducer
	case 5:
		return model.SpanKindConsumer
	default:
		return model.SpanKindServer
	}
}

func parseOTLPAttributes(attrs []otlpKeyValue) map[string]any {
	result := make(map[string]any, len(attrs))
	for _, a := range attrs {
		result[a.Key] = extractAnyValue(a.Value)
	}
	return result
}

func extractAnyValue(v otlpAnyValue) any {
	if v.StringValue != "" {
		return v.StringValue
	}
	if v.IntValue != nil {
		return *v.IntValue
	}
	if v.BoolValue != nil {
		return *v.BoolValue
	}
	if v.DoubleValue != nil {
		return *v.DoubleValue
	}
	if v.Value != nil {
		return v.Value
	}
	return nil
}

// OTLP JSON Wire Protocol Models
type otlpTraceRequest struct {
	ResourceSpans []otlpResourceSpans `json:"resourceSpans"`
}

type otlpResourceSpans struct {
	Resource   otlpResource     `json:"resource"`
	ScopeSpans []otlpScopeSpans `json:"scopeSpans"`
}

type otlpResource struct {
	Attributes []otlpKeyValue `json:"attributes"`
}

type otlpScopeSpans struct {
	Spans []otlpSpan `json:"spans"`
}

type otlpSpan struct {
	TraceID           string         `json:"traceId"`
	SpanID            string         `json:"spanId"`
	ParentSpanID      string         `json:"parentSpanId"`
	Name              string         `json:"name"`
	Kind              int            `json:"kind"`
	StartTimeUnixNano any            `json:"startTimeUnixNano"`
	EndTimeUnixNano   any            `json:"endTimeUnixNano"`
	Attributes        []otlpKeyValue `json:"attributes"`
	Status            otlpStatus     `json:"status"`
}

type otlpStatus struct {
	Message string `json:"message"`
	Code    int    `json:"code"`
}

type otlpLogRequest struct {
	ResourceLogs []otlpResourceLogs `json:"resourceLogs"`
}

type otlpResourceLogs struct {
	Resource  otlpResource   `json:"resource"`
	ScopeLogs []otlpScopeLog `json:"scopeLogs"`
}

type otlpScopeLog struct {
	LogRecords []otlpLogRecord `json:"logRecords"`
}

type otlpLogRecord struct {
	TimeUnixNano   any            `json:"timeUnixNano"`
	SeverityNumber int            `json:"severityNumber"`
	SeverityText   string         `json:"severityText"`
	Body           otlpAnyValue   `json:"body"`
	Attributes     []otlpKeyValue `json:"attributes"`
	TraceID        string         `json:"traceId"`
	SpanID         string         `json:"spanId"`
}

type otlpKeyValue struct {
	Key   string       `json:"key"`
	Value otlpAnyValue `json:"value"`
}

type otlpAnyValue struct {
	StringValue string   `json:"stringValue,omitempty"`
	IntValue    *int64   `json:"intValue,omitempty"`
	BoolValue   *bool    `json:"boolValue,omitempty"`
	DoubleValue *float64 `json:"doubleValue,omitempty"`
	Value       any      `json:"value,omitempty"`
}
