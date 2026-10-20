package tracing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

var traceparentRegex = regexp.MustCompile(`^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$`)

// SpanContext holds W3C Trace Context attributes.
type SpanContext struct {
	TraceID    string
	SpanID     string
	TraceFlags string
	TraceState string
}

// IsValid checks if trace ID and span ID are properly formatted non-zero hex strings.
func (sc SpanContext) IsValid() bool {
	return len(sc.TraceID) == 32 && sc.TraceID != "00000000000000000000000000000000" &&
		len(sc.SpanID) == 16 && sc.SpanID != "0000000000000000"
}

// HeaderString serializes the SpanContext into W3C traceparent header format.
func (sc SpanContext) HeaderString() string {
	flags := sc.TraceFlags
	if flags == "" {
		flags = "01"
	}
	return fmt.Sprintf("00-%s-%s-%s", sc.TraceID, sc.SpanID, flags)
}

type spanContextKey struct{}

// WithSpanContext stores a SpanContext in context.
func WithSpanContext(ctx context.Context, sc SpanContext) context.Context {
	return context.WithValue(ctx, spanContextKey{}, sc)
}

// SpanContextFromContext extracts SpanContext from context if present.
func SpanContextFromContext(ctx context.Context) (SpanContext, bool) {
	if ctx == nil {
		return SpanContext{}, false
	}
	sc, ok := ctx.Value(spanContextKey{}).(SpanContext)
	return sc, ok
}

// ExtractW3C parses traceparent and tracestate from HTTP request headers.
func ExtractW3C(r *http.Request) (SpanContext, bool) {
	if r == nil {
		return SpanContext{}, false
	}
	raw := strings.TrimSpace(r.Header.Get("traceparent"))
	if raw == "" {
		return SpanContext{}, false
	}

	matches := traceparentRegex.FindStringSubmatch(raw)
	if len(matches) != 4 {
		return SpanContext{}, false
	}

	sc := SpanContext{
		TraceID:    matches[1],
		SpanID:     matches[2],
		TraceFlags: matches[3],
		TraceState: r.Header.Get("tracestate"),
	}
	if !sc.IsValid() {
		return SpanContext{}, false
	}
	return sc, true
}

// InjectW3C injects W3C traceparent and tracestate into outbound HTTP headers.
func InjectW3C(sc SpanContext, req *http.Request) {
	if req == nil || !sc.IsValid() {
		return
	}
	req.Header.Set("traceparent", sc.HeaderString())
	if sc.TraceState != "" {
		req.Header.Set("tracestate", sc.TraceState)
	}
}

// NewTraceID generates a random 16-byte (32 hex characters) trace ID.
func NewTraceID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// NewSpanID generates a random 8-byte (16 hex characters) span ID.
func NewSpanID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
