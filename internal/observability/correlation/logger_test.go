package correlation

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestLoggerRedactsSensitiveFields(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := NewLogger(buf, slog.LevelInfo, true)

	logger.Info("test message",
		slog.String("username", "alice"),
		slog.String("authorization", "Bearer secret-token-123"),
		slog.String("client_secret", "super-confidential-secret"),
		slog.String("api_key", "sk-1234567890"),
	)

	output := buf.String()

	if strings.Contains(output, "secret-token-123") {
		t.Errorf("security violation: authorization token was not redacted! Output: %s", output)
	}
	if strings.Contains(output, "super-confidential-secret") {
		t.Errorf("security violation: client secret was not redacted! Output: %s", output)
	}
	if strings.Contains(output, "sk-1234567890") {
		t.Errorf("security violation: api key was not redacted! Output: %s", output)
	}
	if !strings.Contains(output, "[REDACTED]") {
		t.Errorf("expected [REDACTED] in output, got: %s", output)
	}
	if !strings.Contains(output, "alice") {
		t.Errorf("expected non-sensitive field alice to be preserved, got: %s", output)
	}
}

func TestLoggerPropagatesContext(t *testing.T) {
	buf := &bytes.Buffer{}
	logger := NewLogger(buf, slog.LevelInfo, true)

	ctx := WithContext(context.Background(), "tenant-alpha", "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7")
	logger.InfoContext(ctx, "inbound request processed")

	output := buf.String()

	if !strings.Contains(output, "tenant-alpha") {
		t.Errorf("expected tenant_id in log context, got: %s", output)
	}
	if !strings.Contains(output, "4bf92f3577b34da6a3ce929d0e0e4736") {
		t.Errorf("expected trace_id in log context, got: %s", output)
	}
	if !strings.Contains(output, "00f067aa0ba902b7") {
		t.Errorf("expected span_id in log context, got: %s", output)
	}
}
