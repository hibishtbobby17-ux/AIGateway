# ADR-0005: OpenTelemetry Observability Pipeline and Storage Adapters

## Status
Accepted

## Context
A primary capability of the platform is providing comprehensive, real-time observability across AI gateway operations, tool calls, and agent interactions. Distributed traces, logs, and metrics must be ingested via standard protocols (OTLP), attributed to tenants, correlated, and persisted. Crucially, as stated in `PROJECT_INTENT.md`: "Gateway traffic must not depend on the availability of the dashboard or telemetry storage. Telemetry failure must not indefinitely block gateway traffic."

## Decision
1. **OpenTelemetry Standardization**:
   - Ingest telemetry using standard **OTLP/HTTP (`:4318`)** and **OTLP/gRPC (`:4317`)** endpoints.
   - Internal instrumentation uses the official `go.opentelemetry.io/otel` SDK.
   - Trace context propagation adheres strictly to the **W3C Trace Context** specification (`traceparent` and `tracestate`).
2. **Asynchronous Bounded Ring Buffer & Load Shedding**:
   - Inbound and internal telemetry items are passed to an in-memory, thread-safe, bounded ring buffer (default capacity: 10,000 batches).
   - If the ring buffer reaches capacity (e.g., due to ClickHouse slow query execution or network disconnect), the buffer drops telemetry events and increments a `telemetry_dropped_total` counter.
   - **Critical Invariant**: Gateway request execution is asynchronous with respect to telemetry persistence; an outage in telemetry storage never blocks or degrades gateway proxy throughput.
3. **Storage Adapter Architecture**:
   - The platform defines clean storage interfaces (`TraceStorageAdapter`, `LogStorageAdapter`, `MetricStorageAdapter`).
   - **Traces & Structured Logs**: Standardize on **ClickHouse** as the primary high-throughput columnar storage adapter. ClickHouse provides sub-second query performance across billions of spans with tenant-keyed partitioning.
   - **Metrics**: Standardize on a **Prometheus-compatible** metrics endpoint (`/metrics` scrape endpoint) alongside an OTLP metric exporter to Prometheus / VictoriaMetrics.
   - **Standalone / Low-Resource Fallback**: For minimal local developer setups without ClickHouse, provide a lightweight SQLite/PostgreSQL telemetry adapter or in-memory circular ring buffer for recent trace inspection.
4. **Data Redaction & Tenant Attribution**:
   - Telemetry ingestion pipeline injects verified `tenant_id` into all span attributes (`tenant.id`) and resource attributes.
   - Automated redaction filter executes before persistence, masking headers (`authorization`, `cookie`), secrets, and sensitive tool parameters defined in tenant redaction rules.

## Consequences
### Positive
- Vendor-neutral, standards-compliant observability stack based on OpenTelemetry.
- Resilience: telemetry storage outages do not impact user-facing gateway availability.
- Sub-second analytical trace queries in ClickHouse even under heavy tool-invocation loads.

### Negative
- Running ClickHouse in standalone developer environments adds container overhead; addressed by providing a lightweight fallback mode for local testing.
