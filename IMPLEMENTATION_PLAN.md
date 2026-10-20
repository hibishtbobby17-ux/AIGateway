Implementation Plan: AI Gateway and Observability Platform
1. Instructions for the coding agent

Before modifying the repository:

Read PROJECT_INTENT.md completely.
Inspect the repository and identify existing code, dependencies, and conventions.
Determine whether this is a new project or an extension of an existing project.
Create an implementation checklist and document unresolved architectural decisions.
Write architecture decision records for important choices.
Implement one milestone at a time.
Run the required tests before marking any task complete.
Update this file after every milestone.

Do not overwrite existing functionality without understanding it.

Do not generate all modules in a single pass. Do not leave security-critical code as permissive placeholders. Clearly identify incomplete functionality.

2. Initial technology baseline

Use the following defaults unless repository constraints or a documented ADR justify a change:

Backend: Go.
Frontend console: React and TypeScript, including management workflows and interactive topology/communication views.
Primary database: PostgreSQL.
Cache: optional Redis.
Telemetry instrumentation and ingestion: OpenTelemetry SDKs and Collector.
Trace and log storage: ClickHouse or a compatible alternative selected through an ADR.
Metrics: Prometheus-compatible backend.
Deployment: Docker, Docker Compose, Kubernetes, and one platform Helm chart that supports a complete single-release installation.
API style: REST for management APIs; use protocol-appropriate transports for MCP and A2A.
Testing: Go unit and integration tests, frontend tests, security tests, and load tests.

Pin supported protocol versions and dependency versions. Verify library compatibility and maintenance status before adopting them.

3. Repository structure

Establish a monorepo with clear module boundaries:

cmd/
  gateway/
  control-plane/
  migrate/

internal/
  mcp/
    transport/
    session/
    discovery/
    aggregation/
    routing/
  a2a/
    protocol/
    registry/
    routing/
    tasks/
  identity/
    oauth/
    oidc/
    providers/
    tokens/
    keys/
  policy/
  tenants/
  registry/
  config/
  resilience/
  secrets/
  observability/
    instrumentation/
    ingestion/
    correlation/
    topology/
  storage/
    postgres/
    cache/
    telemetry/
  api/

web/
  console/

sdks/
  platform-conventions/

deployments/
  docker/
  compose/
  kubernetes/
  helm/

migrations/
configs/
examples/
tests/
  integration/
  security/
  resilience/
  load/

docs/
  adr/
  architecture/
  operations/
  security/

PROJECT_INTENT.md
IMPLEMENTATION_PLAN.md
README.md
Makefile
Dockerfile


Adapt the structure to repository conventions where appropriate. Avoid unnecessary empty packages.

4. Milestone 0: Discovery and architecture
Tasks
- [x] Inspect repository contents and existing conventions.
- [x] Identify required protocol versions and compatible libraries.
- [x] Document the system context and component architecture.
- [x] Define core domain entities and module ownership.
- [x] Define tenant isolation and identity boundaries.
- [x] Define the configuration model and secret references.
- [x] Select initial telemetry storage components.
- [x] Document standalone and Kubernetes deployment models.
- [x] Create ADRs for significant technology and security choices.
- [x] Establish a risk register and prioritized implementation backlog.

Deliverables
- [x] Architecture overview: [`docs/architecture/overview.md`](docs/architecture/overview.md)
- [x] Component dependency diagram: [`docs/architecture/component-dependencies.md`](docs/architecture/component-dependencies.md)
- [x] Initial domain model: [`docs/architecture/domain-model.md`](docs/architecture/domain-model.md)
- [x] Security risk register: [`docs/security/risk-register.md`](docs/security/risk-register.md)
- [x] Development environment plan: [`docs/operations/development-environment.md`](docs/operations/development-environment.md)
- [x] Architecture Decision Records:
  - [`docs/adr/0001-monorepo-and-technology-baseline.md`](docs/adr/0001-monorepo-and-technology-baseline.md)
  - [`docs/adr/0002-mcp-protocol-and-transport-strategy.md`](docs/adr/0002-mcp-protocol-and-transport-strategy.md)
  - [`docs/adr/0003-a2a-protocol-and-lifecycle-management.md`](docs/adr/0003-a2a-protocol-and-lifecycle-management.md)
  - [`docs/adr/0004-identity-and-access-control.md`](docs/adr/0004-identity-and-access-control.md)
  - [`docs/adr/0005-opentelemetry-pipeline-and-storage.md`](docs/adr/0005-opentelemetry-pipeline-and-storage.md)
  - [`docs/adr/0006-persistence-and-migration-strategy.md`](docs/adr/0006-persistence-and-migration-strategy.md)
  - [`docs/adr/0007-outbound-networking-ssrf-mitigation.md`](docs/adr/0007-outbound-networking-ssrf-mitigation.md)
  - [`docs/adr/0008-resilience-and-concurrency-management.md`](docs/adr/0008-resilience-and-concurrency-management.md)
  - [`docs/adr/0009-oauth-authorization-server.md`](docs/adr/0009-oauth-authorization-server.md)

Exit criteria
The architecture has explicit trust boundaries, clear state ownership, a documented dependency strategy, and no unresolved design decision that would invalidate the first vertical slice. (Milestone 0 verified and complete).

5. Milestone 1: Foundation
Detailed Task Checklist:
- [x] 1.1 Module & Entry Points Initialization
  - [x] Initialize root `go.mod` (`project_alpha`) with Go toolchain.
  - [x] Scaffold `cmd/gateway/main.go` entry point.
  - [x] Scaffold `cmd/control-plane/main.go` entry point.
  - [x] Scaffold `cmd/migrate/main.go` CLI migration tool.
- [x] 1.2 Configuration Loading & Validation (`internal/config`)
  - [x] Define hierarchical config struct supporting YAML files and `GATEWAY_` environment variable overrides.
  - [x] Implement strict configuration validation (fail-fast on missing database URLs, invalid ports, or insecure secret keys in production mode).
  - [x] Add unit tests verifying valid configs, default fallbacks, and descriptive errors for invalid configs.
- [x] 1.3 Structured Logging & Context Correlation (`internal/observability/correlation`)
  - [x] Wrap Go's `log/slog` with JSON and text formatters.
  - [x] Integrate request correlation ID and W3C Trace Context (`trace_id`, `span_id`) extraction into logger context.
  - [x] Implement sensitive field redaction in logger (stripping Authorization headers, API keys, passwords).
  - [x] Add unit tests verifying secret redaction and context field propagation.
- [x] 1.4 Database Connection & Migration Engine (`internal/storage`, `migrations/`)
  - [x] Configure connection pool with bounded limits (`MaxConns`, `MinConns`, `MaxConnIdleTime`) for both `jackc/pgx/v5` and pure-Go `modernc.org/sqlite`.
  - [x] Integrate embedded SQL migration runner (`migrations/migrations.go`) executing versioned `.sql` files.
  - [x] Create initial migration `000001_init_schema.up.sql` and `000001_init_schema.down.sql` with cross-database ANSI SQL (tenants, projects, oauth_clients, policies, mcp_servers, agents, a2a_tasks, audit_logs).
  - [x] Verify automated up and down migrations via tests and CLI (`cmd/migrate/main.go`).
- [x] 1.5 Tenant-Aware Domain Repository & Interfaces (`internal/tenants`, `internal/storage`)
  - [x] Define repository interfaces for Tenant and Project with mandatory `tenant_id` scoping (`internal/tenants/model.go`).
  - [x] Implement SQL repository methods (`internal/storage/tenants_repo.go`) with parameterized queries.
  - [x] Add integration tests verifying cross-tenant isolation at the query layer (`internal/storage/db_test.go`).
- [x] 1.6 Health, Readiness, and Startup Probes (`internal/api/health`)
  - [x] Implement `/healthz` (liveness: process is alive).
  - [x] Implement `/readyz` (readiness: DB connection pool is active and probe checks pass).
  - [x] Implement `/startupz` (startup: initialization complete).
  - [x] Add unit/integration tests for probe responses under healthy and degraded states.
- [x] 1.7 Graceful Shutdown & Lifecycle Management
  - [x] Implement signal interception (`SIGINT`, `SIGTERM`).
  - [x] Sequence shutdown: mark readiness probe unhealthy, drain in-flight HTTP connections within a bounded timeout (25s).
  - [x] Automated test for clean exit on context cancellation.
- [x] 1.8 Containerization & Local Development Tooling
  - [x] Create multi-stage `Dockerfile` producing minimal distroless runtime containers.
  - [x] Create `deployments/compose/docker-compose.dev.yaml` with PostgreSQL 16, ClickHouse, and Jaeger.
  - [x] Create standard `.gitignore` and default `configs/gateway.yaml`.
- [x] 1.9 Code Quality, Linting & CI Scaffolding
  - [x] Configure `.golangci.yml` with essential linters (`govet`, `errcheck`, `staticcheck`, `gosec`).
  - [x] Add GitHub Actions CI workflow (`.github/workflows/ci.yaml`) running linting and tests.

Acceptance criteria
- A clean checkout can build and run the application executables (`cmd/gateway`, `cmd/control-plane`, `cmd/migrate`).
- Invalid configuration fails with actionable, descriptive error messages.
- Database migrations execute cleanly up and down from a fresh database.
- Health (`/healthz`) and readiness (`/readyz`) endpoints accurately reflect component status.
- Graceful shutdown releases resources cleanly within the configured deadline without connection drops.
- CI and linting pass with zero warnings.
- Secrets and authentication tokens are strictly redacted from logs.

Do not begin implementing protocol modules (Milestone 2+) until this foundation passes.

6. Milestone 2: MCP Gateway
Tasks
- [x] Implement the selected MCP protocol version (2024-11-05) and required transports (SSE + HTTP POST).
- [x] Register and configure upstream MCP servers (`internal/mcp/registry`).
- [x] Proxy discovery (`tools/list`, `resources/list`, `prompts/list`) and invocation (`tools/call`) operations.
- [x] Add stable internal server identifiers and per-tenant isolation.
- [x] Add a registry for multiple upstream servers (`internal/mcp/registry/registry.go`).
- [x] Implement aggregated tool discovery (`internal/mcp/aggregation/aggregator.go`).
- [x] Define duplicate tool-name and namespace behavior via canonical `<server_prefix>::<tool_name>` namespacing.
- [x] Implement catalog caching, refresh, and invalidation (`Aggregator.InvalidateCache`).
- [x] Route tool calls to their owning upstream (`Aggregator.CallTool`).
- [x] Add supported resource and prompt aggregation.
- [x] Add per-upstream timeouts and concurrency limits (`resilience.Bulkhead`).
- [x] Implement connection lifecycle and health checks (`resilience.CircuitBreaker`).
- [x] Add structured errors and request correlation (`protocol.Error`, JSON-RPC codes).
- [x] Implement safe outbound networking and SSRF protections (`resilience.SafeDialer`, `resilience.ValidateTargetURL`).
- [x] Add unit, protocol compatibility, and integration tests (`tests/integration/mcp_gateway_test.go`).

Acceptance criteria
- [x] A client connects through one logical endpoint (`/mcp/v1/sse` and `/mcp/v1/messages`).
- [x] Tools from multiple configured servers are discoverable.
- [x] Every tool call reaches the correct upstream.
- [x] Duplicate names have deterministic behavior (namespaced with server prefix).
- [x] Upstream failures are surfaced without crashing the gateway.
- [x] Stale catalogs are handled according to documented policy.
- [x] Unsafe destinations are rejected (SSRF deny-list blocking private and metadata IPs).
- [x] Tests cover reconnects, timeouts, invalid messages, and upstream failures.
7. Milestone 3: Identity and authorization
Tasks
- [x] Define the baseline tenant-scoped OAuth client, grant, redirect URI, scope, issuer/audience, and policy models.
- [x] Integrate ORY Fosite for composed OAuth authorization-code and client-credentials endpoint handling with PKCE S256.
- [x] Add SQL persistence for tenant-scoped client registrations, confidential secret hashes, authorization-code/PKCE state, access/refresh sessions, and client-assertion replay IDs.
- [x] Provide an injectable authorization/consent boundary and fail closed when it is not configured; use the authenticated principal from verified bearer-token middleware and persist explicit, tenant-scoped client consent in SQL.
- [x] Implement interactive user login and consent UX/approval flow (`internal/identity/idp`).
- [x] Issue Fosite ES256 JWT access tokens with key IDs and tenant/scope claims compatible with the platform verifier.
- [x] Wire the provider into runtime endpoints after shared signing-key persistence and authenticated user/consent are available (`cmd/gateway/main.go`).
- [x] Integrate external OIDC discovery and issuer validation (`internal/identity/oidc/discovery.go`).
- [x] Add provider configuration and claim mapping (`internal/identity/oidc/sql_repository.go` and `internal/identity/oidc/federation.go`).
- [x] Implement the built-in IdP foundation (`internal/identity/idp/user.go` and `migrations/000008_users.up.sql`).
- [x] Define signing-key storage, JWKS publication, and rotation with AES-256-GCM encrypted private keys in shared SQL and refresh-on-read across replicas; deployments must supply a shared 32-byte encryption key.
- [x] Implement strict ES256 token claim/time/issuer/audience validation and durable SQL revocation checked on every verification; Fosite revocation invalidates stored sessions and persists hashed JTIs, failing closed when revocation storage is unavailable.
- [x] Implement RBAC and extensible ABAC authorization with tenant-scoped rules, role matching, action scopes, required-scope constraints, and trusted claim attributes.
- [x] Enforce discovery-time and invocation-time authorization for MCP tools, resources, and prompts when the policy engine is attached; invocation is independently checked and missing/mismatched verified principals are denied.
- [x] Persist tenant-scoped role and required-scope policy attributes, and validate/decode persisted rules strictly into the policy engine.
- [x] Wire strict bearer-token authentication, shared SQL signing keys, durable revocation checks, and SQL-loaded policies into the gateway runtime.
- [x] Implement downstream credential selection and delegated authentication (`internal/identity/delegation/delegation.go` and `internal/mcp/upstream/client.go`).
- [x] Add administrative authorization and audit events (`internal/audit/sql_recorder.go`, `internal/api/middleware/admin.go`, and `cmd/control-plane/main.go`).
- [x] Add focused tests for Fosite PKCE S256, durable code redemption across provider recreation, confidential and public client constraints, scope boundaries, secret hashing, JWT verification, and migrations.
- [x] Add tenant-isolation and broader OAuth security tests (`tests/security/tenant_isolation_test.go` and `tests/security/oauth_security_test.go`).
Acceptance criteria
Valid supported clients authenticate successfully.
Invalid issuers, audiences, redirect URIs, and token signatures are rejected.
PKCE validation is enforced.
Authorization requests fail closed unless a trusted authenticated user/consent authorization service is configured.
Authorization codes are single-use, bound to the registered client and exact redirect URI, and authorization/PKCE state persists in SQL.
Confidential client secrets are bcrypt-hashed by the default Fosite hasher and are never retained or exposed in plaintext; deployments can supply a stronger Fosite-compatible hasher.
Fosite-issued ES256 access tokens pass the platform verifier with required issuer, audience, tenant, role, and scope claims.
Client credentials cannot exceed their assigned permissions.
Unauthorized tools are hidden from discovery where appropriate and always denied at invocation.
Downstream credentials are selected according to explicit trust configuration.
Signing-key rotation and failure behavior are tested.
Cross-tenant access attempts fail.
No token or client secret is exposed in logs.

Document any built-in IdP functionality that remains unsuitable for production.

8. Milestone 4: A2A Gateway
Tasks
- [x] Select and document the supported A2A protocol version (`a2a/v1` per ADR-0003).
- [x] Implement agent registration and discovery (`internal/a2a/registry/registry.go`).
- [x] Support Agent Card retrieval and validation (`internal/a2a/protocol/protocol.go` & `internal/a2a/registry`).
- [x] Implement authenticated routing (`internal/a2a/routing/router.go` and `internal/a2a/routing/client.go`).
- [x] Implement task submission and lifecycle handling (`internal/a2a/tasks/store.go` and `internal/a2a/transport/handler.go`).
- [x] Support required status updates and streaming (Server-Sent Events `/a2a/v1/tasks/{id}/events` with historical replay).
- [x] Add deadlines, concurrency limits, and bounded retries (`resilience.Bulkhead`, `HTTPAgentClient` retries).
- [x] Add circuit breakers and upstream health checks (`resilience.CircuitBreaker`, ping endpoints).
- [x] Define durable task-state behavior (`a2a_tasks` and `a2a_task_events` tables in SQL).
- [x] Add tenant and policy enforcement (`a2a:agents:discover`, `a2a:tasks:submit`, strict tenant isolation).
- [x] Propagate trace context (W3C `traceparent` injection onto upstream requests).
- [x] Add task audit records and integration tests (`internal/audit`, `tests/integration/a2a_gateway_test.go`).
Acceptance criteria
- [x] Agents can be registered and routed through the gateway.
- [x] Unauthorized agent access is denied.
- [x] Task status follows the selected protocol.
- [x] Failures and timeouts are represented consistently.
- [x] Task state follows the documented persistence model.
- [x] Tests cover disconnects, duplicate requests, and upstream failures.
9. Milestone 5: Observability pipeline
Tasks
Integrate OpenTelemetry instrumentation in the gateway.
Add inbound and outbound request spans.
Add MCP tool-call and A2A task attributes.
Propagate W3C Trace Context.
Configure OTLP ingestion over required transports.
Implement telemetry authentication and tenant attribution.
Integrate trace, log, and metric storage adapters.
Define sampling, batching, retention, and overload policies.
Add redaction and sensitive-field filtering.
Add trace/log correlation.
Add example SDK instrumentation for Go, Python, TypeScript, and Java.
Document application log ingestion options.
Add telemetry failure and overload tests.
Acceptance criteria
Gateway requests emit useful spans and metrics.
Instrumented applications can export telemetry to the platform.
Trace context is preserved across supported boundaries.
Telemetry is attributed to the correct tenant.
Sensitive values are redacted according to policy.
Gateway requests do not block indefinitely on telemetry storage.
Buffering and memory usage remain bounded during backend outages.
10. Milestone 6: Topology and console
Tasks
Create a React/TypeScript web frontend and tenant-aware console authentication.
Implement authenticated management APIs for tenant-scoped registry, connection, gateway, and policy configuration.
Build workflows to register, edit, enable/disable, validate, and inspect MCP servers and A2A agents, including connection health and actionable errors.
Build server and agent detail views with configuration and relevant status.
Build an interactive configured topology graph showing registered MCP servers, agents, and configured connections.
Build an observed interaction graph showing actual MCP tool calls and A2A communications, with time-range and tenant/environment filters.
Clearly distinguish configured relationships from observed telemetry and link graph nodes/edges to relevant details, tool calls, tasks, and traces.
Add trace search and waterfall visualization.
Add correlated log search.
Add metrics charts and time-range filtering.
Add MCP invocation and A2A task details.
Add audit and health views.
Implement pagination, query limits, loading, empty, success, and error states; never show mock data as live state.
Ensure administrative configuration changes are backend-validated, authorized, tenant-scoped, and audited where security-relevant.
Add frontend unit/component tests and end-to-end smoke tests for key management and graph workflows.
Document and automate a local frontend/backend workflow that can exercise server/agent configuration and configured-versus-observed graph behavior against actual service or telemetry data.
Acceptance criteria
Authorized users can configure and inspect tenants, MCP servers, agents, upstream connections, and policies through the frontend and management APIs.
Configuration submitted through the frontend is validated and persisted by the backend, with errors shown clearly and sensitive values not exposed.
The console displays actual backend and telemetry data rather than placeholders.
Configured and observed topology are visually and semantically distinguishable.
Observed graph edges represent actual interactions in the selected time range and link to corresponding details where available.
Users cannot query or modify another tenant's configuration or telemetry.
Trace details can be correlated with associated logs.
The UI handles loading, empty results, and backend errors correctly.
Frontend tests and end-to-end smoke tests cover the principal management and visualization flows.
The documented local development workflow starts dependencies, applies migrations, runs services and tests, and verifies key frontend and MCP/A2A flows without relying on production infrastructure.
11. Milestone 7: Resilience and production hardening
Tasks
Add bounded concurrency and backpressure.
Configure retries with exponential backoff and jitter.
Ensure retries respect idempotency and deadlines.
Add circuit breakers and bulkheads.
Add rate limits and request-size limits.
Add graceful draining and shutdown tests.
Verify multi-replica operation.
Add failure-injection and load tests.
Add dependency and vulnerability scanning.
Add backup and restore procedures.
Define retention, alerting, and operational runbooks.
Document performance test methodology and results.
Acceptance criteria
Upstream failure does not exhaust unrelated gateway resources.
Queue sizes and concurrency are bounded.
Non-idempotent operations are not blindly retried.
The gateway remains operational when telemetry storage is unavailable, within documented limits.
Failure recovery and graceful shutdown pass automated tests.
Security tests cover SSRF, authorization bypass, tenant isolation, and secret exposure.
Performance results include workload and environment details.
12. Milestone 8: Deployment and release readiness
Tasks
Finalize standalone binary and Docker deployment.
Finalize Docker Compose configuration.
Create Kubernetes manifests and package the platform in one umbrella Helm chart, including the frontend, gateway, control plane, and enabled in-chart supporting workloads.
Make the platform chart the standard Kubernetes installation path; a standard deployment must not require users to install separate charts for first-party platform components.
Provide values for image versions, replicas, resources, ingress/TLS, secrets, persistence, external database/telemetry backends, and optional components without splitting the platform into separate installation operations.
Validate clean installation, configuration overrides, upgrade, and rollback using a single Helm release and one documented `helm install` command.
Deploy the complete chart to a disposable local kind or minikube cluster from a clean checkout and run automated readiness and frontend/gateway smoke tests against the installed release.
Configure readiness, liveness, and startup probes.
Configure resource requests, limits, and autoscaling.
Add PodDisruptionBudgets and topology spread constraints.
Document TLS, secrets, database, and telemetry configuration.
Test rolling upgrades and rollback for the single chart release.
Test database backup and restore.
Write installation, upgrade, troubleshooting, and operations guides.
Publish a release checklist and known limitations.
Acceptance criteria
Standalone deployment works from documented instructions.
Kubernetes deployment installs the complete platform, including its frontend and backend components, using one Helm chart and one `helm install` operation.
First-party components share one Helm release and can be configured through that chart's values; external infrastructure may be provided by the operator.
Configuration is validated before production activation.
Single-release rolling upgrades and rollback have been tested.
The one-chart installation and core user-facing workflows pass repeatable local Kubernetes deployment smoke tests, with documented cleanup and troubleshooting steps.
External dependencies and HA requirements are documented.
The release has no unacknowledged security-critical placeholders.
13. Cross-cutting engineering rules

Apply throughout every milestone:

Keep modules independently testable.
Use context cancellation and explicit timeouts.
Bound all queues, pools, buffers, and concurrent operations.
Avoid global mutable state.
Validate all external input.
Keep secrets out of logs and source control.
Use explicit database transactions where needed.
Define cache invalidation behavior.
Keep protocol-specific logic separate from common policy and identity.
Use migrations for durable schema changes.
Add tests with every feature.
Update API documentation and examples.
Document deviations from PROJECT_INTENT.md.
Never claim tests passed unless they were executed.
14. Required status tracking

Maintain this checklist at the end of every coding session:

| Field | Current Status |
| :--- | :--- |
| **Current milestone** | Milestone 4: A2A Gateway (complete); preparing Milestone 5: Observability pipeline |
| **Completed tasks** | Milestones 0, 1, 2, 3, and 4 are complete and verified. Milestone 4 implements the full Agent-to-Agent (A2A) Gateway stack: pinned `a2a/v1` protocol specification; Agent Card JSON validation and discovery; SQL and in-memory multi-tenant agent registry (`internal/a2a/registry`); durable task state machine and historical task events with SSE pub/sub streaming (`internal/a2a/tasks`); resilient upstream agent client with SSRF protection, circuit breakers, concurrency bulkheads, token anti-relay, and W3C `traceparent` injection (`internal/a2a/routing`); A2A router coordinating task dispatch, deadlines, and state transitions; A2A HTTP transport handler mounted into `cmd/gateway/main.go` supporting synchronous and asynchronous task submissions (`POST /a2a/v1/tasks`), idempotent re-executions, task details, cancellation, SSE event streaming, policy enforcement (`a2a:agents:discover`, `a2a:tasks:submit`), and security audit trails; and comprehensive unit and end-to-end integration tests. |
| **In progress** | None (Milestone 4 complete). |
| **Blocked** | None. |
| **Tests executed** | `go test ./...` and `go vet ./...` passed across all packages with 0 errors, including all new A2A registry, routing, task store, transport, and end-to-end integration tests. |
| **Known defects** | Production key-encryption secret provisioning via cloud secret managers and automated old-key retirement policy are documented for future milestones. Resource servers require shared SQL availability for revocation checks. |
| **Architectural decisions** | ADR-0001 through ADR-0009 active. Pinned MCP version 2024-11-05. Pinned A2A protocol version `a2a/v1`. |
| **Next task** | Begin Milestone 5: Observability pipeline (OpenTelemetry tracing, metrics, OTLP ingestion, span attributes, and log correlation). |

15. First action

Start with Milestone 0.

Inspect the repository, write the architecture overview and ADRs, establish the initial domain model, and prepare the Milestone 1 task breakdown.

Do not start implementing all gateway protocols, the identity provider, and the observability console simultaneously.

After Milestone 0 is reviewed, implement Milestone 1 and verify its acceptance criteria before proceeding.

The project's source of truth is PROJECT_INTENT.md for what the system must achieve and this document for the order in which it must be implemented.