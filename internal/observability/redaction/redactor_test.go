package redaction_test

import (
	"testing"

	"project_alpha/internal/observability/model"
	"project_alpha/internal/observability/redaction"
)

func TestRedactor_RedactSpanAndLog(t *testing.T) {
	redactor := redaction.NewRedactor("custom_ssn")

	span := &model.Span{
		SpanID:  "span-1",
		TraceID: "trace-1",
		Name:    "HTTP POST /mcp/v1/messages",
		Attributes: map[string]any{
			"http.status_code": 200,
			"authorization":    "Bearer secret-jwt-token-12345",
			"api_key":          "live-secret-key",
			"custom_ssn":       "123-45-6789",
			"user.email":       "user@example.com",
			"nested": map[string]any{
				"password": "super-secret-password",
				"normal":   "safe value",
			},
		},
		Events: []model.SpanEvent{
			{
				Name: "request_received",
				Attributes: map[string]any{
					"header.auth": "Bearer eyJhbGci...",
				},
			},
		},
	}

	sanitized := redactor.RedactSpan(span)

	if sanitized.Attributes["authorization"] != "[REDACTED]" {
		t.Errorf("expected authorization to be redacted, got %v", sanitized.Attributes["authorization"])
	}
	if sanitized.Attributes["api_key"] != "[REDACTED]" {
		t.Errorf("expected api_key to be redacted, got %v", sanitized.Attributes["api_key"])
	}
	if sanitized.Attributes["custom_ssn"] != "[REDACTED]" {
		t.Errorf("expected custom_ssn to be redacted, got %v", sanitized.Attributes["custom_ssn"])
	}
	if sanitized.Attributes["user.email"] != "user@example.com" {
		t.Errorf("expected user.email to remain untouched, got %v", sanitized.Attributes["user.email"])
	}

	nested, ok := sanitized.Attributes["nested"].(map[string]any)
	if !ok || nested["password"] != "[REDACTED]" || nested["normal"] != "safe value" {
		t.Errorf("expected nested map to be correctly redacted, got %+v", nested)
	}

	if sanitized.Events[0].Attributes["header.auth"] != "[REDACTED]" {
		t.Errorf("expected event header.auth to be redacted, got %v", sanitized.Events[0].Attributes["header.auth"])
	}
}
