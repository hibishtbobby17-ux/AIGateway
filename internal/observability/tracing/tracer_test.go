package tracing_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"AIGateway/internal/observability/model"
	"AIGateway/internal/observability/tracing"
)

type testSpanSink struct {
	mu    sync.Mutex
	spans []*model.Span
}

func (s *testSpanSink) EnqueueSpan(span *model.Span) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.spans = append(s.spans, span)
}

func TestW3C_ParsingAndInjection(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "http://example.com/test", nil)
	validHeader := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	req.Header.Set("traceparent", validHeader)

	sc, ok := tracing.ExtractW3C(req)
	if !ok {
		t.Fatal("failed extracting valid W3C traceparent")
	}
	if sc.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("unexpected trace id: %s", sc.TraceID)
	}
	if sc.SpanID != "00f067aa0ba902b7" {
		t.Errorf("unexpected span id: %s", sc.SpanID)
	}

	// Re-inject into outbound request
	outReq, _ := http.NewRequest(http.MethodPost, "http://upstream.com/rpc", nil)
	tracing.InjectW3C(sc, outReq)

	if outReq.Header.Get("traceparent") != validHeader {
		t.Errorf("expected %s, got %s", validHeader, outReq.Header.Get("traceparent"))
	}
}

func TestTracer_ParentChildRelationship(t *testing.T) {
	sink := &testSpanSink{}
	tracer := tracing.NewTracer("test-service", sink)

	ctx, parent := tracer.Start(context.Background(), "parent_operation",
		tracing.WithSpanKind(model.SpanKindServer),
		tracing.WithTenantID("tenant-alpha"),
	)
	parent.SetAttribute("test.key", "val-1")

	childCtx, child := tracer.Start(ctx, "child_operation",
		tracing.WithSpanKind(model.SpanKindInternal),
	)
	child.SetAttribute("child.step", 2)
	child.End()

	parent.End()

	sink.mu.Lock()
	defer sink.mu.Unlock()

	if len(sink.spans) != 2 {
		t.Fatalf("expected 2 spans in sink, got %d", len(sink.spans))
	}

	childSpan := sink.spans[0]
	parentSpan := sink.spans[1]

	if childSpan.TraceID != parentSpan.TraceID {
		t.Errorf("child traceID %s != parent traceID %s", childSpan.TraceID, parentSpan.TraceID)
	}
	if childSpan.ParentSpanID != parentSpan.SpanID {
		t.Errorf("child parentSpanID %s != parent spanID %s", childSpan.ParentSpanID, parentSpan.SpanID)
	}
	if childSpan.TenantID != "tenant-alpha" {
		t.Errorf("expected tenant-alpha propagated, got %s", childSpan.TenantID)
	}
	_ = childCtx
}

func TestTraceMiddleware_Integration(t *testing.T) {
	sink := &testSpanSink{}
	tracer := tracing.NewTracer("test-gateway", sink)

	handler := tracing.TraceMiddleware(tracer)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/mcp/v1/tools", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rec.Code)
	}
	if rec.Header().Get("X-Trace-ID") == "" {
		t.Error("expected X-Trace-ID response header")
	}

	sink.mu.Lock()
	defer sink.mu.Unlock()

	if len(sink.spans) != 1 {
		t.Fatalf("expected 1 span recorded, got %d", len(sink.spans))
	}

	s := sink.spans[0]
	if s.Name != "GET /mcp/v1/tools" {
		t.Errorf("unexpected span name: %s", s.Name)
	}
	if s.Attributes["http.status_code"] != http.StatusCreated {
		t.Errorf("expected status code 201 in attributes, got %v", s.Attributes["http.status_code"])
	}
}
