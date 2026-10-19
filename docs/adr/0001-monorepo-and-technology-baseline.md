# ADR-0001: Monorepo Structure and Technology Baseline

## Status
Accepted

## Context
The AI Gateway and Observability Platform requires high performance, strict protocol conformance, low latency proxying, robust multi-tenant concurrency, and an intuitive management UI. We need to select the baseline programming language, runtime architecture, monorepo layout, and web framework while adhering to the principles set out in `PROJECT_INTENT.md`.

## Decision
1. **Core Backend**: Adopt **Go (1.23+)** as the primary language for all gateway, control-plane, and migration executables.
   - Go provides native concurrency (goroutines/channels), high network I/O throughput, low memory footprint, single-binary distribution, and a mature OpenTelemetry ecosystem.
2. **Architecture**: Implement as a **Modular Monolith** with clean internal package boundaries.
   - Avoid distributed microservice overhead during initial milestones.
   - Separate binary entry points (`cmd/gateway`, `cmd/control-plane`, `cmd/migrate`) sharing common `internal/` packages.
   - Support both standalone single-process deployment and multi-workload Kubernetes deployments.
3. **Frontend Management Console**: Adopt **React 18+ with TypeScript** built with **Vite**.
   - Strict TypeScript interfaces for API contracts.
   - Visualizations using React Flow or Cytoscape for topology, and custom canvas/SVG for OpenTelemetry trace waterfall timelines.
4. **Primary Persistence**: Standardize on **PostgreSQL 16+** using the `pgx/v5` driver for high-performance connection pooling and raw SQL with parameterized queries.

## Consequences
### Positive
- Single repository simplifies coordinated changes across gateway protocols, API models, and migrations.
- Go's strict type system and fast compiler accelerate development and testing.
- Single-binary deployment dramatically simplifies standalone on-premise installation and Docker Compose setups.
- Clear internal package boundaries prevent spaghettification.

### Negative
- Requires maintaining discipline against circular package imports in Go.
- Go lacks dynamic plugin loading across OS platforms without CGO, necessitating static compilation or RPC/subprocess adapters for extensions.

## Alternatives Considered
- **Rust**: Exceptional performance and safety, but slower compile times and a less mature enterprise OpenTelemetry and OIDC ecosystem compared to Go.
- **Node.js/TypeScript**: Fast initial prototyping, but higher memory footprint, event-loop blocking risks under CPU-intensive cryptographic token verification or JSON schema validation, and less predictable concurrency under heavy load.
- **Microservices from Day 1**: Premature distributed complexity, increased latency between gateway and policy engines, and complex local development workflows.
