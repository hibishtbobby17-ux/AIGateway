# ADR-0003: Agent-to-Agent (A2A) Protocol Baseline and Task Lifecycle

## Status
Accepted

## Context
Agentic AI workflows increasingly require autonomous agents to discover peer agents, delegate subtasks, receive streaming progress updates, and propagate execution context across trust and organizational boundaries. The platform must provide an A2A Gateway that secures, routes, and tracks these multi-agent interactions.

## Decision
1. **A2A Specification Baseline**:
   - Adopt the emerging **A2A (Agent2Agent) Protocol Standard** (JSON over HTTP/REST + SSE).
   - **Agent Discovery**: Standardize on **Agent Cards** published at `/.well-known/agent.json` or served via Gateway registry at `/a2a/v1/agents/{id}/card`. The Agent Card specifies capabilities, input/output JSON schemas, supported protocols, authentication requirements, and rate limits.
2. **Task Lifecycle Management**:
   - Task initiation: `POST /a2a/v1/tasks` (with optional `Idempotency-Key` header).
   - Task inspection: `GET /a2a/v1/tasks/{task_id}`.
   - Task streaming updates: `GET /a2a/v1/tasks/{task_id}/events` via Server-Sent Events (SSE).
   - Task cancellation: `POST /a2a/v1/tasks/{task_id}/cancel`.
3. **Durable Task State Model**:
   - Task state machine: `PENDING` $\rightarrow$ `RUNNING` $\rightarrow$ (`STREAMING`) $\rightarrow$ `COMPLETED` | `FAILED` | `TIMED_OUT` | `CANCELLED`.
   - Task state and ordered `TaskEvent` history are persisted in PostgreSQL.
   - Durability is guaranteed across gateway pod crashes: if a gateway replica fails mid-task, another replica can query status or handle subsequent status callbacks.
4. **Context & Trace Propagation**:
   - Mandatory propagation of W3C Trace Context (`traceparent`, `tracestate`) on all downstream A2A HTTP headers and SSE events.
   - Gateway acts as a distributed trace intermediary, injecting gateway span IDs and tenant tags.
5. **Execution Semantics & Network Failure Guarantees**:
   - The platform enforces **at-most-once execution** for non-idempotent task requests.
   - When a network timeout occurs during a task delegation, the gateway records state as `UNKNOWN_OUTCOME` or `TIMED_OUT` and **does not blindly retry** non-idempotent operations.
   - Retries are only permitted if the task is explicitly marked idempotent by the caller or carries a verified `Idempotency-Key`.

## Consequences
### Positive
- Interoperability with autonomous agent frameworks (LangGraph, AutoGen, CrewAI, Google ADK).
- Deterministic task state auditing and durable event playback for disconnected clients.
- Traceability across deep multi-agent delegation trees.

### Negative
- Persisting every task milestone event incurs database write I/O; requires event batching or partitioning for high-throughput deployments.
