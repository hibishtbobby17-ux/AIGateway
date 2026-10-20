# OpenTelemetry SDK Instrumentation and Log Ingestion Guide

This guide documents how application services and agents export traces, metrics, and logs to the AI Gateway & Observability Platform using standard OpenTelemetry SDKs and W3C Trace Context.

---

## 1. Platform Ingestion Endpoints

The AI Gateway provides standard OTLP/HTTP endpoints:

| Signal | Endpoint | Wire Format |
| :--- | :--- | :--- |
| **Traces** | `POST http://<gateway-host>:8080/v1/traces` | OTLP / JSON (`application/json`) |
| **Logs** | `POST http://<gateway-host>:8080/v1/logs` | OTLP / JSON (`application/json`) |
| **Metrics** | `POST http://<gateway-host>:8080/v1/metrics` | OTLP / JSON (`application/json`) |
| **Prometheus Scrape** | `GET http://<gateway-host>:8080/metrics` | Prometheus text format (`text/plain; version=0.0.4`) |

### Multi-Tenant Attribution

Every export request must be attributed to a tenant using any of the following methods:
1. **HTTP Header**: `X-Tenant-ID: <tenant-slug-or-id>`
2. **OTel Resource Attribute**: `tenant.id = "<tenant-slug-or-id>"`
3. **Bearer Token**: `Authorization: Bearer <token>` (claims parsed by gateway)

---

## 2. Multi-Language SDK Examples

### Go

```go
package main

import (
	"context"
	"log"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
)

func initTracer(ctx context.Context, tenantID, gatewayURL string) (*sdktrace.TracerProvider, error) {
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(gatewayURL+"/v1/traces"),
		otlptracehttp.WithHeaders(map[string]string{
			"X-Tenant-ID": tenantID,
		}),
	)
	if err != nil {
		return nil, err
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("order-service"),
			semconv.ServiceVersion("1.0.0"),
		),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp, nil
}
```

---

### Python

```python
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

def setup_telemetry(tenant_id: str, gateway_url: str = "http://localhost:8080"):
    resource = Resource.create({
        "service.name": "agent-orchestrator",
        "service.version": "1.0.0",
        "tenant.id": tenant_id,
    })

    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=f"{gateway_url}/v1/traces",
        headers={"X-Tenant-ID": tenant_id},
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    tracer = trace.get_tracer("agent-orchestrator")
    with tracer.start_as_current_span("analyze_prompt") as span:
        span.set_attribute("agent.prompt_length", 240)
        span.set_attribute("ai.model", "gemini-1.5-pro")
```

---

### TypeScript / Node.js

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const tenantId = process.env.TENANT_ID || 'tenant-alpha';
const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:8080';

const traceExporter = new OTLPTraceExporter({
  url: `${gatewayUrl}/v1/traces`,
  headers: {
    'X-Tenant-ID': tenantId,
  },
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'ai-client-app',
    'tenant.id': tenantId,
  }),
  traceExporter,
});

sdk.start();
```

---

### Java

```java
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.propagation.ContextPropagators;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.semconv.ResourceAttributes;

public class TelemetryConfig {
    public static OpenTelemetry initOpenTelemetry(String tenantId, String gatewayUrl) {
        Resource resource = Resource.getDefault().toBuilder()
            .put(ResourceAttributes.SERVICE_NAME, "payment-agent")
            .put("tenant.id", tenantId)
            .build();

        OtlpHttpSpanExporter spanExporter = OtlpHttpSpanExporter.builder()
            .setEndpoint(gatewayUrl + "/v1/traces")
            .addHeader("X-Tenant-ID", tenantId)
            .build();

        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
            .addSpanProcessor(BatchSpanProcessor.builder(spanExporter).build())
            .setResource(resource)
            .build();

        return OpenTelemetrySdk.builder()
            .setTracerProvider(tracerProvider)
            .setPropagators(ContextPropagators.create(W3CTraceContextPropagator.getInstance()))
            .buildAndRegisterGlobal();
    }
}
```

---

## 3. Application Log Ingestion Options

Per ADR-0005, log collection supports three primary patterns:

### Option A: Direct OTLP Log Export (Recommended for OTel SDKs)
Applications configure their logging framework (e.g. `slog` in Go, Python `logging` handler, or Logback in Java) with the OpenTelemetry OTLP Log Appender targeting `POST /v1/logs`.
- Logs are automatically tagged with active `trace_id` and `span_id`.
- Tenant attribution is injected via the `X-Tenant-ID` header or `tenant.id` attribute.

### Option B: Log Forwarder Sidecar (Vector, FluentBit, or OTel Collector)
Applications write structured JSON logs to `stdout` / `/var/log`. A sidecar daemon tails logs, correlates trace context, and ships batches to the gateway:

```yaml
# Vector configuration example
sources:
  app_logs:
    type: "file"
    include: ["/var/log/app/*.json"]

transforms:
  parse_json:
    type: "remap"
    inputs: ["app_logs"]
    source: |
      . = parse_json!(.message)
      .tenant_id = get_env_var("TENANT_ID")

sinks:
  gateway_otlp:
    type: "http"
    inputs: ["parse_json"]
    uri: "http://gateway:8080/v1/logs"
    encoding:
      codec: "json"
    headers:
      X-Tenant-ID: "${TENANT_ID}"
```

### Option C: Filebeat / Fluentd DaemonSet in Kubernetes
In Kubernetes environments, a node-level daemon collects container logs, matches Kubernetes pod labels (`app.kubernetes.io/name`, `tenant.id`), and streams records directly to the gateway OTLP pipeline.
