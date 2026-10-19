Project Intent: AI Gateway and Observability Platform
1. Purpose

Build a secure, production-oriented platform that provides:

An MCP Gateway for securing, routing, and aggregating multiple MCP servers behind a single logical endpoint.
An A2A Gateway for secure agent discovery, routing, delegation, and task lifecycle management.
A built-in identity provider and integrations with external OAuth/OIDC identity providers.
An OpenTelemetry-based observability platform for traces, metrics, logs, and interaction topology.
A management and observability console.
Resilient standalone and Kubernetes deployment options.

The platform should make it easy for organizations to connect AI applications, tools, services, and agents without losing control over identity, access, reliability, or visibility.

2. Product principles
Security must be enforced at every trust boundary.
Observability must be built into the architecture from the first milestone.
MCP and A2A must remain separate protocol modules while sharing common platform services.
Gateway traffic must not depend on the availability of the dashboard or telemetry storage.
Multi-tenancy must be designed into identity, storage, routing, configuration, and telemetry.
All resource consumption must be bounded and configurable.
Prefer established protocols, libraries, and standards over proprietary implementations.
Support both standalone and clustered deployments using the same application code.
All important functionality must be testable and documented.
Never claim a feature is implemented until it works and its acceptance tests pass.
3. Core product capabilities
3.1 MCP Gateway

The MCP Gateway must:

Support the explicitly selected MCP protocol version and required transports.
Register and protect multiple upstream MCP servers.
Provide a single logical endpoint exposing tools from multiple servers.
Aggregate tool catalogs and supported resources and prompts.
Route calls to the correct backend using stable internal server identities.
Resolve duplicate tool names through explicit namespaces or conflict policies.
Apply authentication and authorization during both discovery and execution.
Support per-tenant, per-client, per-user, per-server, and per-tool policies.
Provide upstream authentication, connection management, health checks, timeouts, and error handling.
Protect against SSRF, unsafe outbound destinations, oversized requests, and resource exhaustion.
Support catalog caching, refresh, invalidation, and upstream configuration changes.
Instrument requests and upstream calls for distributed tracing.

A tool's visibility in discovery must never be treated as proof of authorization to execute it.

3.2 A2A Gateway

The A2A Gateway must:

Register agents and maintain their endpoint metadata.
Support Agent Card discovery and the selected A2A protocol version.
Authenticate and authorize agent-to-agent communication.
Route requests and manage task lifecycle operations.
Support status updates and streaming where required by the selected protocol.
Propagate trace context across agent boundaries.
Apply deadlines, bounded retries, concurrency limits, and circuit breakers.
Persist task state when durability requirements demand it.
Record task failures, routing decisions, and security-relevant events.
Enforce tenant isolation between agents and their associated resources.
3.3 Identity and access management

The platform must support both built-in identity services and external identity providers.

Required flows:

OAuth authorization-code flow with PKCE using S256.
Client credentials flow for confidential machine clients.
OIDC discovery and integrations with Okta, Auth0, Microsoft Entra ID, and compatible providers.
Multiple external IdPs and configurable claim mapping.
Client registration, scopes, audiences, signing keys, and token validation.
Secure credential management, key rotation, and appropriate token revocation.
RBAC and extensible ABAC authorization policies.
Tenant-aware identity and administration.
Auditable administrative and identity operations.

Use maintained security libraries. Clearly separate the platform's identity provider from upstream OAuth clients and resource-server authorization.

Never forward a token to a downstream server without validating the downstream audience and authorization requirements. Use delegated authentication or token exchange where necessary.

3.4 OpenTelemetry and observability

The platform must build on standard OpenTelemetry APIs, SDKs, and Collector components.

Required functionality:

OTLP ingestion over supported HTTP and gRPC transports.
Instrumentation for gateway operations, MCP calls, and A2A tasks.
Example integrations for Go, Python, TypeScript/Node.js, and Java.
Trace, log, and metric correlation.
W3C Trace Context propagation.
Tenant-aware ingestion authentication and resource attribution.
Configurable sampling, batching, buffering, and retention.
Sensitive-field redaction.
Storage adapters for traces, logs, and metrics.
A documented mechanism for collecting application logs.

Do not assume that installing a tracing SDK automatically captures every application log. Provide supported SDK, logging bridge, and Collector ingestion options.

Telemetry failure must not indefinitely block gateway traffic.

3.5 Management and observability console

The console must provide:

Tenant, project, user, and client management.
MCP server and A2A agent registration.
Gateway and authorization policy configuration.
A configured topology graph.
An observed interaction graph.
Distributed trace search and waterfall views.
Correlated structured log search.
Traffic, latency, error, and resource metrics.
MCP tool-call and A2A task inspection.
Security audit events.
Health status and alerts.
Filtering by tenant, environment, service, and time range.

The graph must distinguish configured relationships from observed interactions. Observed edges must be derived from actual telemetry and use time-bounded statistics.

3.6 Resilience and availability

The platform must include:

Bounded concurrency and connection pools.
Request deadlines and configurable timeouts.
Bounded retries with exponential backoff and jitter.
Idempotency-aware retry decisions.
Circuit breakers and bulkheads.
Rate limiting and backpressure.
Graceful shutdown and bounded request draining.
Health and readiness endpoints.
Versioned configuration with validation and rollback.
Shared durable state where required.
Multi-replica operation without essential process-local state.
Backup, restore, and recovery procedures.

Do not promise exactly-once execution for remote tool calls or agent operations. Document uncertain outcomes after network failures.

3.7 Deployment

Standalone deployment must support:

Runnable application executables.
Validated configuration files and environment overrides.
Docker and Docker Compose.
PostgreSQL integration.
Configurable telemetry backends.
Health checks and structured logs.
Documented installation and upgrade procedures.

Kubernetes deployment must support:

Separate gateway, control-plane, and telemetry workloads where appropriate.
Helm charts and standard manifests.
TLS and ingress integration.
Resource requests and limits.
Readiness, liveness, and startup probes.
Autoscaling, disruption budgets, and rolling upgrades.
Secrets integration and external database services.
Documented high-availability and recovery requirements.

Both deployment modes must use the same application code and configuration model.

4. Architectural direction

Use Go for the gateway and backend services and React with TypeScript for the console.

Use PostgreSQL as the primary durable application database. Keep identity, protocol handling, authorization, routing, telemetry processing, and storage behind clear module boundaries.

Use OpenTelemetry SDKs and Collector components for instrumentation and ingestion. Select telemetry storage through replaceable adapters. ClickHouse and a Prometheus-compatible metrics backend are candidate defaults.

Begin with a modular monolith and separately deployable gateway, control plane, and telemetry workloads. Introduce additional distributed services only when there is a clear scaling or operational reason.

The core architecture must include:

MCP protocol module.
A2A protocol module.
Identity and OAuth module.
Authorization policy engine.
Server and agent registries.
Routing and resilience services.
Configuration and secrets management.
Observability instrumentation and ingestion.
Telemetry storage adapters.
Topology processing.
Administrative API and console.
5. Security boundaries

Enforce tenant isolation in API handlers, storage queries, cache keys, routing, task state, and telemetry search.

Never store plaintext credentials in ordinary configuration records or log secrets and tokens.

Validate external destinations and protect against SSRF and DNS rebinding.

Keep administrative endpoints independently protected.

Use least-privilege authorization and audit sensitive configuration and identity changes.

Apply safe defaults for TLS, token handling, request limits, and secret redaction.

6. Engineering quality

All features must include appropriate tests, error handling, operational documentation, and configuration validation.

Use automated formatting, linting, static analysis, dependency scanning, unit tests, integration tests, security tests, and load tests.

Document protocol versions, compatibility constraints, external dependencies, failure modes, and known limitations.

Do not implement the entire system in one generation pass. Work in milestones and validate each milestone before continuing.

7. Definition of success

The initial production-oriented release must demonstrate that:

A client can authenticate and access multiple MCP servers through one logical endpoint.
Discovery and execution enforce authorization.
Supported OAuth flows and external IdP integrations pass integration tests.
A2A requests are authenticated, authorized, routed, and observable.
Instrumented applications and the gateway produce correlated telemetry.
The console visualizes real traces and observed service interactions.
Multiple gateway replicas operate against shared durable state.
Failure handling, overload, shutdown, and telemetry outages are tested.
Standalone and Kubernetes deployments are reproducible.
Security limitations, recovery procedures, and operational requirements are documented.

This document defines the product's intent. Implementation details belong in IMPLEMENTATION_PLAN.md and architecture decision records.