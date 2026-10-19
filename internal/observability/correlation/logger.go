package correlation

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
)

type contextKey string

const (
	TraceIDKey  contextKey = "trace_id"
	SpanIDKey   contextKey = "span_id"
	TenantIDKey contextKey = "tenant_id"
)

var sensitiveKeys = map[string]bool{
	"authorization": true,
	"auth":          true,
	"token":         true,
	"secret":        true,
	"password":      true,
	"api_key":       true,
	"apikey":        true,
	"client_secret": true,
}

// RedactingHandler wraps an slog.Handler to redact sensitive keys and values.
type RedactingHandler struct {
	slog.Handler
}

// Handle inspects record attributes, extracts context metadata, and redacts secrets.
func (h *RedactingHandler) Handle(ctx context.Context, r slog.Record) error {
	// Extract distributed trace and tenant context if present
	if ctx != nil {
		if tid, ok := ctx.Value(TenantIDKey).(string); ok && tid != "" {
			r.AddAttrs(slog.String("tenant_id", tid))
		}
		if traceID, ok := ctx.Value(TraceIDKey).(string); ok && traceID != "" {
			r.AddAttrs(slog.String("trace_id", traceID))
		}
		if spanID, ok := ctx.Value(SpanIDKey).(string); ok && spanID != "" {
			r.AddAttrs(slog.String("span_id", spanID))
		}
	}

	// Build sanitized record
	sanitizedRecord := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	r.Attrs(func(a slog.Attr) bool {
		sanitizedRecord.AddAttrs(redactAttr(a))
		return true
	})

	return h.Handler.Handle(ctx, sanitizedRecord)
}

func redactAttr(a slog.Attr) slog.Attr {
	keyLower := strings.ToLower(a.Key)
	for sensitive := range sensitiveKeys {
		if strings.Contains(keyLower, sensitive) {
			return slog.String(a.Key, "[REDACTED]")
		}
	}
	if a.Value.Kind() == slog.KindGroup {
		attrs := a.Value.Group()
		sanitized := make([]slog.Attr, len(attrs))
		for i, sub := range attrs {
			sanitized[i] = redactAttr(sub)
		}
		return slog.Attr{Key: a.Key, Value: slog.GroupValue(sanitized...)}
	}
	return a
}

// NewLogger creates a production-grade, structured logger with redaction.
func NewLogger(w io.Writer, level slog.Level, jsonFormat bool) *slog.Logger {
	if w == nil {
		w = os.Stdout
	}
	var baseHandler slog.Handler
	opts := &slog.HandlerOptions{Level: level}

	if jsonFormat {
		baseHandler = slog.NewJSONHandler(w, opts)
	} else {
		baseHandler = slog.NewTextHandler(w, opts)
	}

	return slog.New(&RedactingHandler{Handler: baseHandler})
}

// WithContext returns a new context with trace, span, and tenant attributes.
func WithContext(ctx context.Context, tenantID, traceID, spanID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if tenantID != "" {
		ctx = context.WithValue(ctx, TenantIDKey, tenantID)
	}
	if traceID != "" {
		ctx = context.WithValue(ctx, TraceIDKey, traceID)
	}
	if spanID != "" {
		ctx = context.WithValue(ctx, SpanIDKey, spanID)
	}
	return ctx
}
