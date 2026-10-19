# AI Gateway and Observability Platform

A secure, high-performance enterprise gateway and observability platform unifying the **Model Context Protocol (MCP)** and the **Agent-to-Agent (A2A)** protocol with enterprise identity, fine-grained access control, distributed tracing, and resilient outbound networking.

---

## Key Features

- **MCP Gateway**: Unifies multiple upstream MCP servers behind a single authenticated logical endpoint with aggregated tool catalogs, namespace conflict resolution, and discovery/invocation policy enforcement.
- **A2A Gateway**: Secure agent discovery via Agent Cards, task lifecycle coordination, streaming status updates, and distributed trace context propagation.
- **Enterprise IAM**: Built-in OAuth 2.1 / OIDC identity provider with PKCE S256, confidential client credentials, external IdP federation (Okta, Auth0, Microsoft Entra ID), and RBAC/ABAC authorization.
- **OpenTelemetry-Native**: End-to-end W3C Trace Context propagation, OTLP ingestion, non-blocking telemetry pipelines with load shedding, ClickHouse trace storage, and Prometheus metrics.
- **Security-First Architecture**: Custom SSRF-safe egress dialer, DNS rebinding mitigations, AES-256-GCM encryption at rest, and zero plaintext secret logging.
- **Dual Deployment Model**: Single-binary standalone deployment (Docker Compose) and horizontally scalable Kubernetes deployment (Helm) using identical application code.

---

## Architecture & Documentation

All architectural decisions, threat models, and domain specifications are documented in `/docs`:

- **[System Architecture Overview](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/architecture/overview.md)**: C4 Level 1 & 2 diagrams, core request flows, trust boundaries, and scalability models.
- **[Component Dependencies](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/architecture/component-dependencies.md)**: Package structure, module boundaries, and prohibited dependency rules.
- **[Domain Model & Persistence](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/architecture/domain-model.md)**: Entity specifications, ERD, and A2A task state machine.
- **[Security Risk Register](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/security/risk-register.md)**: STRIDE threat model, risk mitigations, and automated security verification gates.
- **[Development Environment Plan](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/operations/development-environment.md)**: Prerequisites, local setup, and testing strategy.

### Architecture Decision Records (ADRs)
- [ADR-0001: Monorepo Structure & Technology Baseline](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0001-monorepo-and-technology-baseline.md)
- [ADR-0002: MCP Protocol Specification & Transport Strategy](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0002-mcp-protocol-and-transport-strategy.md)
- [ADR-0003: A2A Protocol Baseline & Task Lifecycle](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0003-a2a-protocol-and-lifecycle-management.md)
- [ADR-0004: Identity, Access Management & Policy Evaluation](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0004-identity-and-access-control.md)
- [ADR-0005: OpenTelemetry Observability Pipeline & Storage Adapters](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0005-opentelemetry-pipeline-and-storage.md)
- [ADR-0006: Primary Persistence & Database Migration Strategy](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0006-persistence-and-migration-strategy.md)
- [ADR-0007: Outbound Networking & SSRF Mitigation Strategy](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0007-outbound-networking-ssrf-mitigation.md)
- [ADR-0008: Resilience, Bulkheads & Concurrency Control](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0008-resilience-and-concurrency-management.md)
- [ADR-0009: OAuth Authorization Server Framework & Persistence](file:///c:/Users/Administrator/Downloads/project/project_alpha/docs/adr/0009-oauth-authorization-server.md)

---

## Implementation Roadmap

The implementation progresses sequentially through the following milestones:

- [x] **Milestone 0: Discovery & Architecture** (Complete)
- [ ] **Milestone 1: Foundation** (Go module, config loading, pgx pool, migrations, health/readiness, graceful shutdown)
- [ ] **Milestone 2: MCP Gateway** (Transports, tool aggregation, namespacing, SSRF-safe routing)
- [ ] **Milestone 3: Identity & Authorization** (OAuth2/PKCE, OIDC, RBAC/ABAC, downstream token safety)
- [ ] **Milestone 4: A2A Gateway** (Agent Cards, task state machine, streaming, context propagation)
- [ ] **Milestone 5: Observability Pipeline** (OTel instrumentation, OTLP ingestion, ClickHouse/Prometheus)
- [ ] **Milestone 6: Topology & Console** (Management APIs, React/TS console, interaction graph)
- [ ] **Milestone 7: Resilience & Production Hardening** (Bulkheads, rate limits, chaos testing)
- [ ] **Milestone 8: Deployment & Release Readiness** (Helm, K8s manifests, backup/restore runbooks)

See [IMPLEMENTATION_PLAN.md](file:///c:/Users/Administrator/Downloads/project/project_alpha/IMPLEMENTATION_PLAN.md) for full task tracking and verification logs.
