# Management Console & Topology Guide

This guide details the architecture, workflows, and local developer setup for the **AI Gateway Management Console & Observability Platform** implemented in Milestone 6.

---

## 1. Overview & Architecture

The Management Console provides a unified, tenant-scoped operations and observability control plane for enterprise AI workloads:

```
+-----------------------------------------------------------------------------------------+
|                        React / TypeScript Management Console                            |
|  [Topology Graphs]  [Traces Waterfall]  [Log Search]  [Metrics]  [MCP & A2A]  [Policies]|
+-----------------------------------------------------------------------------------------+
                                      │  HTTP / REST (Bearer JWT + X-Tenant-ID)
                                      ▼
+-----------------------------------------------------------------------------------------+
|                              Control Plane Runtime                                      |
|  `cmd/control-plane` (Port 8081) - Go Native Binary with Embedded Assets (web.Handler)  |
|  • AuthMiddleware: Signature Verification, Token Expiration, Cross-Tenant Guard         |
|  • RBAC Middleware: Enforces platform-admin, tenant-admin, auditor                      |
+-----------------------------------------------------------------------------------------+
       │                     │                     │                     │
       ▼                     ▼                     ▼                     ▼
[MCP Registry]        [A2A Registry]       [Observability Store]  [Policy Engine]
- Server CRUD         - Agent CRUD         - Spans & Waterfall    - Rule CRUD
- Health Probes       - Health Probes      - Correlated Logs      - Dry-Run Sim
- Tenant Isolation    - Agent Cards        - Metrics Summary      - Audit Logs
```

---

## 2. Key Capabilities & Workflows

### 2.1 Configured Topology vs. Observed Topology
- **Configured Topology (`/api/v1/topology/configured`)**:
  - Dynamically synthesizes registered MCP servers, autonomous A2A agents, and the central AI Gateway.
  - Represents what *should* be available based on administrative registrations.
- **Observed Topology (`/api/v1/topology/observed?duration={15m|1h|6h|24h|7d}`)**:
  - Aggregates actual distributed trace telemetry (`telemetry_spans`) emitted during real traffic.
  - Displays actual call volume, error counts, error rates, average latency, and p95 latency on every node and communication edge.
  - Links edges directly to sample trace IDs for instant debugging.

### 2.2 Distributed Trace Search & Waterfall Visualization
- **Trace Summaries (`/api/v1/traces`)**:
  - Filter by trace ID, span name, HTTP status code, or time range.
  - Summarizes root span, overall duration, total spans, and error state.
- **Waterfall Visualizer (`/api/v1/traces/{id}`)**:
  - Displays interactive Gantt-style timeline breakdown of parent-child spans.
  - Inspect span attributes (`http.route`, `mcp.tool_name`, `a2a.agent_id`), timing, and status messages.
  - "View Correlated Logs" deep-links directly into the log search view with pre-filtered trace ID.

### 2.3 Correlated Structured Log Search
- **Log Query (`/api/v1/logs`)**:
  - Filter by severity (`DEBUG`, `INFO`, `WARN`, `ERROR`), trace ID, and full-text search string.
  - Correlates logs directly with distributed spans.

### 2.4 Upstream MCP Server & A2A Agent Management
- **MCP Servers (`/api/v1/mcp-servers`)**:
  - Full CRUD operations with transport selection (SSE, HTTP POST, STDIO).
  - Active connection probe endpoint (`/api/v1/mcp-servers/{id}/health`) actively pings upstream endpoints and records health status (`HEALTHY`, `DEGRADED`, `UNHEALTHY`).
- **A2A Agents (`/api/v1/agents`)**:
  - Full CRUD operations with `AgentCard` capability declarations.
  - Active health probe endpoint (`/api/v1/agents/{id}/health`).

### 2.5 Policy Dry-Run Simulator
- **Policy Management (`/api/v1/policies`)**:
  - Define granular ALLOW/DENY rules for tools, agents, resources, and roles.
- **Dry-Run Engine (`/api/v1/policies/dry-run`)**:
  - Test simulated authorization requests before committing changes to production.
  - Returns simulated decision (`ALLOW` or `DENY`), matched rule ID, and evaluation reason.

### 2.6 Multi-Tenant Isolation & Audit Trail
- Every administrative request requires a valid Bearer token and evaluates the tenant context.
- Cross-tenant requests (`X-Tenant-ID` mismatching the token claims) are rejected with HTTP 403 Forbidden.
- Security and management mutations automatically emit immutable audit entries queryable via `/api/v1/audit`.

---

## 3. Local Developer Setup & Verification

### 3.1 Running the Control Plane with Embedded Console
1. Ensure the database schema is up-to-date:
   ```bash
   go run ./cmd/migrate up
   ```
2. Start the Control Plane binary:
   ```bash
   go run ./cmd/control-plane
   ```
3. Open your browser to:
   - Management Console: `http://localhost:8081/` or `http://localhost:8081/console/`
   - Health check: `http://localhost:8081/healthz`
   - Prometheus metrics: `http://localhost:8081/metrics`

### 3.2 Running Automated Milestone 6 Tests
Execute the comprehensive end-to-end integration test suite:
```bash
go test -v ./tests/integration -run TestConsoleAndAdmin_EndToEnd
```
Run the admin API unit tests:
```bash
go test -v ./internal/api/admin/...
```
Verify the entire repository:
```bash
go test ./...
go vet ./...
```
