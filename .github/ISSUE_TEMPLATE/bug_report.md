---
name: "\U0001F41B Bug Report"
about: Report a bug, regression, or unexpected behavior in AIGateway
title: "[BUG] "
labels: ["bug", "triage"]
assignees: ["hibishtbobby17-ux"]
---

## Bug Summary
<!-- A clear and concise description of what the bug is. -->

## Affected Component(s)
<!-- Check all components affected by this issue -->
- [ ] **Data Plane Gateway** (`gateway/`, `cmd/gateway/`)
- [ ] **Control Plane & Admin API** (`cmd/control-plane/`, `internal/api/`)
- [ ] **Management Console UI** (`console/`, `web/`)
- [ ] **Universal LLM Gateway & Guardrails** (`/api/llm/`, FinOps, Failover)
- [ ] **MCP Gateway** (`internal/mcp/` — Tool Aggregation, SSE, JSON-RPC)
- [ ] **A2A Gateway** (`internal/a2a/` — Agent Cards, Tasks, Routing)
- [ ] **Identity, OAuth 2.1 & Policy Engine** (`internal/identity/`, `internal/policy/`)
- [ ] **Telemetry Ingest & Observability** (`ingest/`, `internal/observability/`)
- [ ] **Deployment / Docker / Helm Charts** (`deployments/`, `deploy/`, `Dockerfile`)

## Steps to Reproduce
1. Start / configure component with `...`
2. Send request or perform UI action `...`
3. Observe error `...`

## Expected Behavior
<!-- Describe what you expected to happen. -->

## Actual Behavior & Logs
<!-- Paste error messages, HTTP status codes, stack traces, or screenshots. -->
```text
Paste logs or response output here
```

## Environment Details
- **AIGateway Version / Commit**: (e.g., `v1.0.0` or `git rev-parse --short HEAD`)
- **Deployment Mode**: (Docker Compose / Kubernetes Helm / Native Binary)
- **OS & Architecture**: (e.g., Linux amd64, Windows amd64, macOS arm64)
- **Go / Node.js Version**: (e.g., Go 1.26, Node.js 20+)
- **Database / Telemetry Sink**: (e.g., PostgreSQL 16, SQLite, ClickHouse, Redis)

## Additional Context / Proposed Fix
<!-- Add any other context, related ADRs, or potential fix suggestions here. -->

