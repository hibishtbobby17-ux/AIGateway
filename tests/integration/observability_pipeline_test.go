package integration_test

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"project_alpha/internal/api/middleware"
	"project_alpha/internal/config"
	"project_alpha/internal/identity/keys"
	"project_alpha/internal/identity/tokens"
	"project_alpha/internal/observability/metrics"
	"project_alpha/internal/observability/model"
	"project_alpha/internal/observability/otlp"
	"project_alpha/internal/observability/pipeline"
	obsstorage "project_alpha/internal/observability/storage"
	"project_alpha/internal/observability/tracing"
	"project_alpha/internal/policy"
	"project_alpha/internal/storage"
	"project_alpha/internal/tenants"
	"project_alpha/migrations"
)

type obsTestCluster struct {
	server        *httptest.Server
	db            *sql.DB
	traceStore    obsstorage.TraceStore
	logStore      obsstorage.LogStore
	pipeline      *pipeline.Pipeline
	tracer        *tracing.Tracer
	metricsReg    *metrics.Registry
	keyManager    *keys.Manager
	policyEngine  *policy.Engine
}

func setupObsCluster(t *testing.T) *obsTestCluster {
	t.Helper()
	ctx := context.Background()

	// 1. In-memory DB with all migrations (including 000010_telemetry)
	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	tenantsRepo := storage.NewSQLTenantRepository(db)
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-a", Name: "Tenant A", Slug: "tenant-a"})
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{ID: "tenant-b", Name: "Tenant B", Slug: "tenant-b"})

	keyManager, _ := keys.NewManager()
	revocationStore := tokens.NewRevocationManager()
	verifier := tokens.NewVerifier(keyManager, revocationStore, "https://gateway.example.com", "ai-gateway")

	policyEngine := policy.NewEngine()

	// 2. Storage and Pipeline
	traceStore := obsstorage.NewSQLTraceStore(db)
	logStore := obsstorage.NewSQLLogStore(db)

	pipe := pipeline.NewPipeline(traceStore, logStore, pipeline.Config{
		Capacity:      1000,
		BatchSize:     5,
		FlushInterval: 50 * time.Millisecond,
	})
	t.Cleanup(func() { _ = pipe.Close() })

	tracer := tracing.NewTracer("ai-gateway", pipe)
	metricsReg := metrics.NewRegistry()
	_ = metrics.NewGatewayMetrics(metricsReg)

	otlpHandler := otlp.NewIngestionHandler(pipe, "tenant-a")

	// 3. HTTP router
	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", metricsReg.Handler())
	otlpHandler.Mount(mux)

	mux.HandleFunc("/test/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"pong"}`))
	})

	handler := tracing.TraceMiddleware(tracer)(mux)
	handler = middleware.AuthMiddleware(verifier, policyEngine)(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(func() { server.Close() })

	return &obsTestCluster{
		server:       server,
		traceStore:   traceStore,
		logStore:     logStore,
		pipeline:     pipe,
		tracer:       tracer,
		metricsReg:   metricsReg,
		keyManager:   keyManager,
		policyEngine: policyEngine,
	}
}

func (c *obsTestCluster) mintToken(t *testing.T, tenantID string) string {
	t.Helper()
	activeKey, _ := c.keyManager.GetActiveKey()
	now := time.Now().UTC()
	claims := &tokens.Claims{
		Issuer:    "https://gateway.example.com",
		Subject:   "test-user",
		Audience:  "ai-gateway",
		TenantID:  tenantID,
		Roles:     []string{"platform-admin"},
		Scopes:    []string{"*"},
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(time.Hour).Unix(),
		TokenID:   "token-obs-test",
	}
	tok, err := tokens.Sign(claims, activeKey)
	if err != nil {
		t.Fatalf("sign token failed: %v", err)
	}
	return tok
}

func TestObservabilityPipeline_EndToEnd(t *testing.T) {
	cluster := setupObsCluster(t)
	client := &http.Client{Timeout: 5 * time.Second}

	tokenA := cluster.mintToken(t, "tenant-a")

	// -------------------------------------------------------------------------
	// 1. Gateway Request Spans & W3C Trace Context
	// -------------------------------------------------------------------------
	t.Run("Gateway Inbound Request Tracing", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/test/ping", nil)
		req.Header.Set("Authorization", "Bearer "+tokenA)

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		traceID := resp.Header.Get("X-Trace-ID")
		traceparent := resp.Header.Get("traceparent")
		if traceID == "" || !strings.HasPrefix(traceparent, "00-") {
			t.Errorf("expected trace headers in response: traceID=%q, traceparent=%q", traceID, traceparent)
		}

		// Wait for pipeline batch flush
		time.Sleep(120 * time.Millisecond)

		// Verify span persisted into SQL
		spans, err := cluster.traceStore.GetTrace(context.Background(), "tenant-a", traceID)
		if err != nil || len(spans) == 0 {
			t.Fatalf("expected span in database for trace %s: %v", traceID, err)
		}
		if spans[0].Name != "GET /test/ping" {
			t.Errorf("unexpected span name: %s", spans[0].Name)
		}
		if spans[0].Attributes["http.status_code"] != float64(200) && spans[0].Attributes["http.status_code"] != 200 {
			t.Errorf("unexpected http.status_code: %v", spans[0].Attributes["http.status_code"])
		}
	})

	// -------------------------------------------------------------------------
	// 2. OTLP Ingestion of External Traces and Logs with Redaction
	// -------------------------------------------------------------------------
	t.Run("OTLP Ingestion and Redaction", func(t *testing.T) {
		traceID := "0123456789abcdef0123456789abcdef"
		spanID := "0123456789abcdef"

		otlpTracePayload := fmt.Sprintf(`{
			"resourceSpans": [
				{
					"resource": {
						"attributes": [
							{"key": "tenant.id", "value": {"stringValue": "tenant-a"}},
							{"key": "service.name", "value": {"stringValue": "agent-worker"}}
						]
					},
					"scopeSpans": [
						{
							"spans": [
								{
									"traceId": "%s",
									"spanId": "%s",
									"name": "ExecuteToolCall",
									"kind": 3,
									"startTimeUnixNano": "1544712660000000000",
									"endTimeUnixNano": "1544712661000000000",
									"attributes": [
										{"key": "authorization", "value": {"stringValue": "Bearer confidential-token"}},
										{"key": "api_key", "value": {"stringValue": "sk-12345"}},
										{"key": "tool.name", "value": {"stringValue": "search_database"}}
									],
									"status": {"code": 1}
								}
							]
						}
					]
				}
			]
		}`, traceID, spanID)

		req, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/v1/traces", bytes.NewReader([]byte(otlpTracePayload)))
		req.Header.Set("Authorization", "Bearer "+tokenA)
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			t.Fatalf("OTLP traces failed: %v, status: %d", err, resp.StatusCode)
		}
		_ = resp.Body.Close()

		// Send correlated log via OTLP
		otlpLogPayload := fmt.Sprintf(`{
			"resourceLogs": [
				{
					"resource": {
						"attributes": [
							{"key": "tenant.id", "value": {"stringValue": "tenant-a"}}
						]
					},
					"scopeLogs": [
						{
							"logRecords": [
								{
									"timeUnixNano": "1544712660500000000",
									"severityText": "INFO",
									"body": {"stringValue": "Tool call dispatched"},
									"traceId": "%s",
									"spanId": "%s",
									"attributes": [
										{"key": "secret", "value": {"stringValue": "super-secret-pw"}}
									]
								}
							]
						}
					]
				}
			]
		}`, traceID, spanID)

		logReq, _ := http.NewRequest(http.MethodPost, cluster.server.URL+"/v1/logs", bytes.NewReader([]byte(otlpLogPayload)))
		logReq.Header.Set("Authorization", "Bearer "+tokenA)
		logReq.Header.Set("Content-Type", "application/json")

		logResp, err := client.Do(logReq)
		if err != nil || logResp.StatusCode != http.StatusOK {
			t.Fatalf("OTLP logs failed: %v, status: %d", err, logResp.StatusCode)
		}
		_ = logResp.Body.Close()

		// Wait for batch flush
		time.Sleep(120 * time.Millisecond)

		// Verify span persisted and redacted
		spans, err := cluster.traceStore.GetTrace(context.Background(), "tenant-a", traceID)
		if err != nil || len(spans) != 1 {
			t.Fatalf("expected 1 span stored for trace %s, got %v", traceID, err)
		}
		if spans[0].Attributes["authorization"] != "[REDACTED]" {
			t.Errorf("expected authorization to be redacted, got %v", spans[0].Attributes["authorization"])
		}
		if spans[0].Attributes["api_key"] != "[REDACTED]" {
			t.Errorf("expected api_key to be redacted, got %v", spans[0].Attributes["api_key"])
		}
		if spans[0].Attributes["tool.name"] != "search_database" {
			t.Errorf("expected tool.name search_database, got %v", spans[0].Attributes["tool.name"])
		}

		// Verify correlated log persisted and redacted
		logs, err := cluster.logStore.QueryLogs(context.Background(), obsstorage.LogFilter{
			TenantID: "tenant-a",
			TraceID:  traceID,
		})
		if err != nil || len(logs) != 1 {
			t.Fatalf("expected 1 correlated log record, got %v", err)
		}
		if logs[0].Attributes["secret"] != "[REDACTED]" {
			t.Errorf("expected secret attribute to be redacted in log, got %v", logs[0].Attributes["secret"])
		}
	})

	// -------------------------------------------------------------------------
	// 3. Prometheus /metrics Endpoint
	// -------------------------------------------------------------------------
	t.Run("Prometheus Metrics Format", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/metrics", nil)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("metrics request failed: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 for /metrics, got %d", resp.StatusCode)
		}

		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)

		if !strings.Contains(bodyStr, "gateway_requests_total") {
			t.Errorf("expected gateway_requests_total in metrics output")
		}
		if !strings.Contains(bodyStr, "# TYPE gateway_requests_total counter") {
			t.Errorf("expected standard Prometheus TYPE definition")
		}
	})

	// -------------------------------------------------------------------------
	// 4. Overload and Load Shedding Protection
	// -------------------------------------------------------------------------
	t.Run("Telemetry Overload Load Shedding", func(t *testing.T) {
		// Enqueue 2000 spans directly into pipeline (capacity is 1000)
		for i := 0; i < 2000; i++ {
			cluster.pipeline.EnqueueSpan(&model.Span{
				SpanID:   fmt.Sprintf("flood-%d", i),
				TenantID: "tenant-a",
			})
		}

		_, dropped, _, _ := cluster.pipeline.Stats()
		if dropped == 0 {
			t.Errorf("expected load shedding to drop excess telemetry, dropped is 0")
		}

		// Ensure gateway request continues to succeed immediately without blocking
		pingReq, _ := http.NewRequest(http.MethodGet, cluster.server.URL+"/test/ping", nil)
		pingReq.Header.Set("Authorization", "Bearer "+tokenA)
		pingResp, err := client.Do(pingReq)
		if err != nil || pingResp.StatusCode != http.StatusOK {
			t.Fatalf("gateway request hung or failed under telemetry overload: %v", err)
		}
		_ = pingResp.Body.Close()
	})

	// -------------------------------------------------------------------------
	// 5. Tenant Isolation in Telemetry Queries
	// -------------------------------------------------------------------------
	t.Run("Tenant Isolation in Trace Queries", func(t *testing.T) {
		// Tenant B attempts to query Tenant A's trace
		_, err := cluster.traceStore.GetTrace(context.Background(), "tenant-b", "0123456789abcdef0123456789abcdef")
		if err == nil {
			t.Error("tenant-b was able to access tenant-a's trace; expected ErrTraceNotFound")
		}

		spansB, err := cluster.traceStore.QuerySpans(context.Background(), obsstorage.TraceFilter{
			TenantID: "tenant-b",
		})
		if err != nil {
			t.Fatalf("query spans failed: %v", err)
		}
		if len(spansB) != 0 {
			t.Errorf("expected 0 spans for tenant-b, got %d", len(spansB))
		}
	})
}
