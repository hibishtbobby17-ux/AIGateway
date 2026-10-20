package redaction

import (
	"strings"

	"project_alpha/internal/observability/model"
)

var defaultSensitiveKeys = map[string]bool{
	"authorization": true,
	"auth":          true,
	"token":         true,
	"secret":        true,
	"password":      true,
	"api_key":       true,
	"apikey":        true,
	"client_secret": true,
	"cookie":        true,
	"set-cookie":    true,
	"access_token":  true,
	"refresh_token": true,
	"private_key":   true,
}

// Redactor masks sensitive fields in telemetry data.
type Redactor struct {
	customKeys map[string]bool
}

// NewRedactor creates a new Redactor with optional custom sensitive keys.
func NewRedactor(customKeys ...string) *Redactor {
	r := &Redactor{
		customKeys: make(map[string]bool),
	}
	for _, k := range customKeys {
		r.customKeys[strings.ToLower(strings.TrimSpace(k))] = true
	}
	return r
}

// IsSensitive returns true if the key matches a known sensitive field.
func (r *Redactor) IsSensitive(key string) bool {
	lower := strings.ToLower(strings.TrimSpace(key))
	if defaultSensitiveKeys[lower] || r.customKeys[lower] {
		return true
	}
	for sensitive := range defaultSensitiveKeys {
		if strings.Contains(lower, sensitive) {
			return true
		}
	}
	return false
}

// RedactMap recursively sanitizes map keys and values.
func (r *Redactor) RedactMap(attrs map[string]any) map[string]any {
	if attrs == nil {
		return nil
	}
	result := make(map[string]any, len(attrs))
	for k, v := range attrs {
		if r.IsSensitive(k) {
			result[k] = "[REDACTED]"
			continue
		}
		result[k] = r.redactValue(v)
	}
	return result
}

func (r *Redactor) redactValue(v any) any {
	switch typed := v.(type) {
	case string:
		lower := strings.ToLower(typed)
		if strings.HasPrefix(lower, "bearer ") {
			return "Bearer [REDACTED]"
		}
		if strings.HasPrefix(lower, "basic ") {
			return "Basic [REDACTED]"
		}
		return typed
	case map[string]any:
		return r.RedactMap(typed)
	case []any:
		res := make([]any, len(typed))
		for i, elem := range typed {
			res[i] = r.redactValue(elem)
		}
		return res
	default:
		return v
	}
}

// RedactSpan sanitizes a span's attributes and events in place.
func (r *Redactor) RedactSpan(span *model.Span) *model.Span {
	if span == nil {
		return nil
	}
	if span.Attributes != nil {
		span.Attributes = r.RedactMap(span.Attributes)
	}
	for i := range span.Events {
		if span.Events[i].Attributes != nil {
			span.Events[i].Attributes = r.RedactMap(span.Events[i].Attributes)
		}
	}
	return span
}

// RedactLog sanitizes a log record's attributes.
func (r *Redactor) RedactLog(record *model.LogRecord) *model.LogRecord {
	if record == nil {
		return nil
	}
	if record.Attributes != nil {
		record.Attributes = r.RedactMap(record.Attributes)
	}
	return record
}
