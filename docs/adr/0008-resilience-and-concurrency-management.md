# ADR-0008: Resilience, Bulkheads, and Concurrency Control

## Status
Accepted

## Context
In a distributed AI ecosystem, upstream MCP tool servers and downstream A2A agents exhibit diverse performance profiles, variable latencies, and intermittent failures. Without strict isolation, a slow or failing upstream server could saturate gateway worker goroutines, exhaust memory, and cascade into total platform unavailability.

## Decision
1. **Upstream Bulkheads (Concurrency Limits)**:
   - Each registered MCP server and A2A agent configuration specifies a `concurrency_limit` (default: 50 in-flight requests).
   - Enforced using buffered Go token channels or semaphores (`golang.org/x/sync/semaphore`).
   - When an upstream reaches its concurrency limit, additional incoming requests receive an immediate `429 Too Many Requests` or `503 Service Unavailable` with a `Retry-After` header, protecting gateway memory and other upstreams.
2. **Circuit Breakers**:
   - Implement a per-upstream circuit breaker with three states: `CLOSED`, `OPEN`, `HALF-OPEN`.
   - Thresholds:
     - 5 consecutive upstream timeouts or 50% error rate over a 10-second rolling window triggers transition to `OPEN`.
     - In `OPEN` state, requests fail fast with `ErrCircuitBreakerOpen` without making network calls.
     - After a cooldown period (default: 30 seconds), transitions to `HALF-OPEN` to probe upstream health with a single request.
3. **Bounded Retries with Exponential Backoff and Full Jitter**:
   - Retries are strictly limited (default: max 3 attempts).
   - Backoff algorithm: $t_{wait} = \text{random}(0, \min(T_{max}, T_{base} \times 2^{\text{attempt}}))$.
   - **Idempotency Rule**: Retries are only permitted on idempotent operations (e.g., read-only discovery, idempotent A2A tasks) or safe transport-level network connection drops before any request bytes were sent. Tool execution (`tools/call`) is **never blindly retried** unless explicitly flagged as idempotent.
4. **Deadlines & Timeouts**:
   - Every inbound request establishes a Go `context.Context` with a deadline.
   - Enforce global gateway timeout (default: 30s) and per-upstream configurable timeouts (e.g., 5s to 60s).
   - Context cancellation propagates immediately to abort active HTTP transport dials and SSE streams.
5. **Graceful Shutdown & Draining**:
   - On `SIGTERM` or `SIGINT`, the gateway:
     1. Switches readiness probe (`/readyz`) to return `503 Service Unavailable` so Kubernetes ingress removes the pod from the routing pool.
     2. Stops accepting new inbound connections.
     3. Allows in-flight requests to complete within a bounded grace period (default: 25 seconds).
     4. Flushes the telemetry ring buffer to storage.
     5. Closes database connection pools and terminates cleanly.

## Consequences
### Positive
- Prevents cascading failures and resource starvation across unrelated upstreams.
- Ensures graceful pod updates in Kubernetes without dropping client connections.
- Protects downstream systems from retry storms via exponential backoff and jitter.

### Negative
- Requires careful tuning of bulkhead limits and timeouts per upstream service to match their respective SLA profiles.
