package otlp_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"AIGateway/internal/observability/otlp"
	"AIGateway/internal/observability/pipeline"
	"AIGateway/internal/observability/storage"
)

func TestOTLPHandler_IngestTracesAndLogs(t *testing.T) {
	memStore := storage.NewMemoryStore(100)
	pipe := pipeline.NewPipeline(memStore, memStore, pipeline.Config{
		Capacity:      1000,
		BatchSize:     5,
		FlushInterval: 50 * time.Millisecond,
	})
	defer pipe.Close()

	handler := otlp.NewIngestionHandler(pipe, "tenant-default")
	mux := http.NewServeMux()
	handler.Mount(mux)

	// 1. Ingest Traces via /v1/traces
	tracePayload := `{
		"resourceSpans": [
			{
				"resource": {
					"attributes": [
						{"key": "service.name", "value": {"stringValue": "checkout-svc"}},
						{"key": "tenant.id", "value": {"stringValue": "tenant-corp"}}
					]
				},
				"scopeSpans": [
					{
						"spans": [
							{
								"traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
								"spanId": "00f067aa0ba902b7",
								"name": "ProcessPayment",
								"kind": 2,
								"startTimeUnixNano": "1544712660000000000",
								"endTimeUnixNano": "1544712661000000000",
								"attributes": [
									{"key": "payment.gateway", "value": {"stringValue": "stripe"}},
									{"key": "authorization", "value": {"stringValue": "Bearer super-secret"}}
								],
								"status": {"code": 1}
							}
						]
					}
				]
			}
		]
	}`

	req := httptest.NewRequest(http.MethodPost, "/v1/traces", bytes.NewReader([]byte(tracePayload)))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for OTLP traces, got %d: %s", rec.Code, rec.Body.String())
	}

	// 2. Ingest Logs via /v1/logs
	logPayload := `{
		"resourceLogs": [
			{
				"resource": {
					"attributes": [
						{"key": "tenant.id", "value": {"stringValue": "tenant-corp"}}
					]
				},
				"scopeLogs": [
					{
						"logRecords": [
							{
								"timeUnixNano": "1544712660000000000",
								"severityText": "INFO",
								"body": {"stringValue": "Order created successfully"},
								"traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
								"spanId": "00f067aa0ba902b7",
								"attributes": [
									{"key": "order_id", "value": {"stringValue": "ord-999"}}
								]
							}
						]
					}
				]
			}
		]
	}`

	logReq := httptest.NewRequest(http.MethodPost, "/v1/logs", bytes.NewReader([]byte(logPayload)))
	logRec := httptest.NewRecorder()

	mux.ServeHTTP(logRec, logReq)

	if logRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for OTLP logs, got %d: %s", logRec.Code, logRec.Body.String())
	}

	// Wait for pipeline batch flush
	time.Sleep(120 * time.Millisecond)

	// Verify trace stored and attributed to tenant-corp
	spans, err := memStore.GetTrace(nil, "tenant-corp", "4bf92f3577b34da6a3ce929d0e0e4736")
	if err != nil {
		t.Fatalf("failed getting trace: %v", err)
	}
	if len(spans) != 1 || spans[0].Name != "ProcessPayment" {
		t.Errorf("unexpected span: %+v", spans)
	}
	// Verify redaction was applied
	if spans[0].Attributes["authorization"] != "[REDACTED]" {
		t.Errorf("expected authorization to be redacted, got %v", spans[0].Attributes["authorization"])
	}

	// Verify log stored
	logs, err := memStore.QueryLogs(nil, storage.LogFilter{
		TenantID: "tenant-corp",
		TraceID:  "4bf92f3577b34da6a3ce929d0e0e4736",
	})
	if err != nil || len(logs) != 1 {
		t.Fatalf("expected 1 log record, got %v (len: %d)", err, len(logs))
	}
	if logs[0].Message != "Order created successfully" {
		t.Errorf("unexpected log message: %s", logs[0].Message)
	}
}
