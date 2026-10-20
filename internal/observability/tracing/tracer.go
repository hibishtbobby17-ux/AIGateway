package tracing

import (
	"context"
	"net/http"
	"sync"
	"time"

	"project_alpha/internal/identity/principal"
	"project_alpha/internal/observability/correlation"
	"project_alpha/internal/observability/model"
)

// SpanSink receives completed spans for processing or buffering.
type SpanSink interface {
	EnqueueSpan(span *model.Span)
}

// Tracer creates and manages OpenTelemetry-compatible spans.
type Tracer struct {
	serviceName string
	sink        SpanSink
}

// NewTracer creates a new Tracer.
func NewTracer(serviceName string, sink SpanSink) *Tracer {
	if serviceName == "" {
		serviceName = "ai-gateway"
	}
	return &Tracer{
		serviceName: serviceName,
		sink:        sink,
	}
}

// SpanOption configures span creation.
type SpanOption func(*spanOptions)

type spanOptions struct {
	kind       string
	attributes map[string]any
	tenantID   string
}

// WithSpanKind specifies the span kind (SERVER, CLIENT, INTERNAL).
func WithSpanKind(kind string) SpanOption {
	return func(o *spanOptions) {
		o.kind = kind
	}
}

// WithAttributes sets initial attributes on the span.
func WithAttributes(attrs map[string]any) SpanOption {
	return func(o *spanOptions) {
		for k, v := range attrs {
			o.attributes[k] = v
		}
	}
}

// WithTenantID sets the tenant ID explicitly.
func WithTenantID(tenantID string) SpanOption {
	return func(o *spanOptions) {
		o.tenantID = tenantID
	}
}

// SpanRecorder records execution milestones, attributes, and timing for a span.
type SpanRecorder struct {
	mu   sync.Mutex
	span model.Span
	sink SpanSink
}

// Start begins a new child span. If parent SpanContext exists in ctx, it links as parent.
func (t *Tracer) Start(ctx context.Context, name string, opts ...SpanOption) (context.Context, *SpanRecorder) {
	so := spanOptions{
		kind:       model.SpanKindInternal,
		attributes: make(map[string]any),
	}
	for _, opt := range opts {
		opt(&so)
	}

	var traceID string
	var parentSpanID string

	// Extract parent span context if available
	if parentSC, ok := SpanContextFromContext(ctx); ok && parentSC.IsValid() {
		traceID = parentSC.TraceID
		parentSpanID = parentSC.SpanID
	} else {
		traceID = NewTraceID()
	}

	spanID := NewSpanID()

	// Extract tenant ID if available
	tenantID := so.tenantID
	if tenantID == "" {
		if p, ok := principal.FromContext(ctx); ok && p.TenantID != "" {
			tenantID = p.TenantID
		}
	}
	if tenantID == "" {
		if tid, ok := ctx.Value(correlation.TenantIDKey).(string); ok {
			tenantID = tid
		}
	}

	childSC := SpanContext{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: "01",
	}

	// Propagate in child context
	childCtx := WithSpanContext(ctx, childSC)
	childCtx = correlation.WithContext(childCtx, tenantID, traceID, spanID)

	so.attributes["service.name"] = t.serviceName
	if tenantID != "" {
		so.attributes["tenant.id"] = tenantID
	}

	now := time.Now().UTC()
	recorder := &SpanRecorder{
		span: model.Span{
			SpanID:       spanID,
			TraceID:      traceID,
			ParentSpanID: parentSpanID,
			TenantID:     tenantID,
			Name:         name,
			Kind:         so.kind,
			StartTime:    now,
			StatusCode:   model.StatusCodeUnset,
			Attributes:   so.attributes,
		},
		sink: t.sink,
	}

	return childCtx, recorder
}

// SpanID returns the span's 16-hex ID.
func (s *SpanRecorder) SpanID() string {
	return s.span.SpanID
}

// TraceID returns the span's 32-hex trace ID.
func (s *SpanRecorder) TraceID() string {
	return s.span.TraceID
}

// SetAttribute adds or updates an attribute on the span.
func (s *SpanRecorder) SetAttribute(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.span.Attributes == nil {
		s.span.Attributes = make(map[string]any)
	}
	s.span.Attributes[key] = value
}

// SetAttributes adds multiple attributes to the span.
func (s *SpanRecorder) SetAttributes(attrs map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.span.Attributes == nil {
		s.span.Attributes = make(map[string]any)
	}
	for k, v := range attrs {
		s.span.Attributes[k] = v
	}
}

// SetStatus updates the span status (OK, ERROR, UNSET).
func (s *SpanRecorder) SetStatus(code, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.span.StatusCode = code
	s.span.StatusMessage = message
}

// AddEvent adds an annotated event to the span.
func (s *SpanRecorder) AddEvent(name string, attrs map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.span.Events = append(s.span.Events, model.SpanEvent{
		Name:       name,
		Timestamp:  time.Now().UTC(),
		Attributes: attrs,
	})
}

// End completes the span timing and dispatches it to the configured sink.
func (s *SpanRecorder) End() {
	s.mu.Lock()
	if !s.span.EndTime.IsZero() {
		s.mu.Unlock()
		return
	}
	s.span.EndTime = time.Now().UTC()
	s.span.DurationMs = float64(s.span.EndTime.Sub(s.span.StartTime).Microseconds()) / 1000.0
	if s.span.StatusCode == model.StatusCodeUnset {
		s.span.StatusCode = model.StatusCodeOk
	}
	spanCopy := s.span
	sink := s.sink
	s.mu.Unlock()

	if sink != nil {
		sink.EnqueueSpan(&spanCopy)
	}
}

// SetTenantID updates or assigns the span's tenant ID.
func (s *SpanRecorder) SetTenantID(tenantID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.span.TenantID = tenantID
	if s.span.Attributes == nil {
		s.span.Attributes = make(map[string]any)
	}
	s.span.Attributes["tenant.id"] = tenantID
}

// Span returns a copy of the completed span.
func (s *SpanRecorder) Span() model.Span {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.span
}

// TraceMiddleware returns an HTTP middleware that starts a SERVER span for every inbound request.
func TraceMiddleware(tracer *Tracer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if tracer == nil {
				next.ServeHTTP(w, r)
				return
			}

			// Extract W3C Trace Context from inbound headers if present
			ctx := r.Context()
			if incomingSC, ok := ExtractW3C(r); ok {
				ctx = WithSpanContext(ctx, incomingSC)
			}

			spanName := r.Method + " " + r.URL.Path
			spanCtx, span := tracer.Start(ctx, spanName,
				WithSpanKind(model.SpanKindServer),
				WithAttributes(map[string]any{
					"http.method":     r.Method,
					"http.path":       r.URL.Path,
					"http.user_agent": r.UserAgent(),
					"http.client_ip":  r.RemoteAddr,
				}),
			)

			// Wrap response writer to capture status code
			rw := &responseCaptureWriter{ResponseWriter: w, statusCode: http.StatusOK}

			// Inject trace headers into response for client correlation
			w.Header().Set("X-Trace-ID", span.TraceID())
			sc, _ := SpanContextFromContext(spanCtx)
			w.Header().Set("traceparent", sc.HeaderString())

			defer func() {
				// Pick up tenant if authenticated downstream by AuthMiddleware
				if p, ok := principal.FromContext(r.Context()); ok && p.TenantID != "" {
					span.SetTenantID(p.TenantID)
				} else if tid := r.Header.Get("X-Tenant-ID"); tid != "" {
					span.SetTenantID(tid)
				}
				span.SetAttribute("http.status_code", rw.statusCode)
				if rw.statusCode >= 500 {
					span.SetStatus(model.StatusCodeError, http.StatusText(rw.statusCode))
				} else {
					span.SetStatus(model.StatusCodeOk, "")
				}
				span.End()
			}()

			next.ServeHTTP(rw, r.WithContext(spanCtx))
		})
	}
}

type responseCaptureWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseCaptureWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseCaptureWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
