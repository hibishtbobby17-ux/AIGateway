PLAN: AI Console + Headless AI Gateway

Instructions for the coding agent. Build in the phases listed in
section 11. Do not move to the next phase until the acceptance
criteria of the current one pass.

0. Assumptions (change here if wrong)

"CC" = OAuth 2.0 client credentials grant.
"Data gateway" = the AI Gateway (data plane).
Default stack (override if the owner specifies otherwise):

Gateway: Go
Console API + UI: TypeScript (Next.js UI, Node API)
Ingest service: Go
DB: Postgres; cache/locks/rate limits: Redis; logs: ClickHouse
(Postgres partitions acceptable for MVP); queue: Redis Streams (Kafka
optional later)

Authorization-code flow is per project (shared service identity) in
v1; per-end-user is a later extension.
Downstream MCP transports in v1: Streamable HTTP and SSE. stdio is out
of scope (document as future work).
Deployment model: single organization in v1, with org_id on all tables
so multi-tenancy can be added later.

1. Goals / Requirements

AI Console is a separate deployment.
Console supports Projects; users can create multiple.
Each project can have multiple downstream MCP servers.
MCP clients connect to a project; each project can use OAuth (client
credentials, authorization code) with an external IdP.
For an MCP client, a project appears as one MCP server exposing the
merged tools of all downstream MCP servers.
The AI Gateway is deployed separately, headless, authenticates to the
console with a secret, and polls connections/settings from the
console.
The gateway automatically sends logs to the console.
Clients can send logs and telemetry to a dedicated ingest endpoint with no UI.
Gateway and console are concurrent and production-grade (Kong-like):
stateless, horizontally scalable, resilient.

2. Architecture

Control plane / data plane split.

Component Role UI Scaling
Console (API + UI) Projects, MCP servers, OAuth config, gateway mgmt,
log viewer Yes Stateless, horizontal
Ingest service Receives logs/telemetry from gateways and clients No
Horizontal, queue-backed
AI Gateway Headless MCP proxy/aggregator, polls config No Horizontal, stateless
Postgres Console source of truth n/a Primary + replicas
Redis Rate limits, token cache, locks, streams n/a Cluster/sentinel
Log store ClickHouse (or partitioned Postgres) n/a n/a

Rules:

Console and gateway never share a database. Gateway talks to console
only over HTTPS.
Each component has its own Dockerfile, CI pipeline, and release cycle.

 MCP client ──► Gateway /p/{slug}/mcp ──► Downstream MCP A, B, C
                   │   ▲
     logs/telemetry│   │ config + tokens (poll, secret auth)
                   ▼   │
               Ingest ─► Queue ─► Log store ◄── Console (API/UI) ◄── Admin
 MCP client ──► Ingest /ingest/v1/* (no UI)

3. Repo layout

/console      # API + UI
/ingest       # ingest service
/gateway      # headless gateway
/shared       # API schemas (OpenAPI), event schemas, generated clients
/deploy       # docker-compose, helm charts
/docs         # runbooks, API docs
/tests        # e2e, load (k6)

4. Data model (console, Postgres)

Organization, User: console auth (OIDC or local).
Project: id, org_id, name, slug (unique), status, settings, config_version.
McpServer: project_id, name, namespace_prefix, transport, url,
auth_type (none|api_key|oauth_cc|oauth_authcode), timeouts, enabled,
health_status, last_checked_at.
ToolPolicy: mcp_server_id, tool_name, enabled, rename (optional).
OAuthConfig: mcp_server_id or project_id, issuer, token_endpoint,
authorization_endpoint, jwks_uri, client_id, client_secret
(encrypted), scopes, audience, redirect_uri, grant_type.
OAuthToken: encrypted access + refresh tokens, expires_at, subject,
status (ok|reauth_required).
GatewayInstance: id, name, secret_hash, last_seen_at, version,
applied_config_version, status, revoked_at.
GatewayProjectBinding: gateway_id, project_id.
ClientCredential: project_id, type (api_key|oauth_client), hash,
scopes, rate_limit, revoked_at.
IngestKey: project_id, hash, revoked_at.
AuditLog: actor, action, target, timestamp, diff (no secrets).
Log/Telemetry events live in the log store, written only through ingest.

Security for data:

Envelope encryption for all secrets (KMS/Vault-backed master key,
per-record data key).
Secrets are write-only via the API; never returned in responses or logs.
Gateway secrets and API keys are stored hashed (shown once at creation).

5. Console features

Auth, user/org management.
Project CRUD. Slug defines the MCP endpoint https://<gateway-host>/p/{slug}/mcp.
MCP server CRUD per project: add, test connection, discover tools,
enable/disable tools, set namespace prefix.
OAuth UI: configure IdP per server/project; Connect button
(authorization code + PKCE); Test token (client credentials).
Gateway management: register gateway, generate secret (shown once),
bind projects, view status/last seen/applied config version,
rotate/revoke secret.
Client credentials + ingest keys per project.
Log and telemetry viewer with filters (project, server, tool, status,
latency, trace ID).
Audit log.

6. Gateway <-> Console protocol

Auth

Gateway env: CONSOLE_URL, GATEWAY_SECRET (plus optional tuning).
POST /api/gateway/v1/auth exchanges secret for a short-lived signed
token (JWT); auto-refresh before expiry.

Config sync (pull)

GET /api/gateway/v1/config?since={version} using ETag / If-None-Match
and ~30s long-poll, plus fallback interval with jitter.
Response: projects, MCP servers, tool policies, inbound auth settings,
rate limits. Monotonic config_version.
Gateway builds the new config fully, validates it, then atomically
swaps (no dropped in-flight requests).
Fail-static: persist last good config to local disk; keep serving if
console is unreachable. Reject invalid configs and keep the old one.
POST /api/gateway/v1/heartbeat: version, health, basic metrics.

Token delivery

Client-credentials secrets delivered to the gateway sealed to a
per-gateway key (or fetched on demand).
Auth-code tokens: POST /api/gateway/v1/tokens/{mcp_server_id} returns
a short-lived access token only; refresh tokens never leave the
console.

7. MCP aggregation (project = one virtual MCP server)

Endpoint per project: /p/{slug}/mcp (Streamable HTTP; SSE optional).
initialize: advertise merged capabilities.
tools/list: fan out to all enabled downstream servers in parallel
(timeouts + short cache), merge, namespace names ({prefix}__{tool}),
apply ToolPolicy.
tools/call: parse prefix, route, strip prefix, forward, normalize errors.
resources/* and prompts/*: same pattern with namespaced URIs/names.
Downstream session pool, per-downstream timeouts, retries (idempotent
only), circuit breakers, bulkheads.
Forward notifications/tools/list_changed when downstream tools change.
Partial failure degrades gracefully: return remaining tools plus a
warning, not a total failure.
Propagate trace context (W3C traceparent) to downstreams.

8. OAuth design

Inbound (client -> gateway, per project)

Support API keys and OAuth 2.1 bearer tokens validated against the
project's external IdP (issuer, JWKS with caching, audience, scopes).
Expose OAuth protected-resource metadata so MCP clients can discover the IdP.

Outbound (gateway -> downstream MCP)

Client credentials: gateway fetches/caches tokens, refreshes before
expiry, single-flight lock per (server, scope) to avoid stampedes.
Authorization code + PKCE: console owns the browser flow (redirect,
callback, state validation, PKCE, exact redirect URI match), stores
encrypted tokens, refreshes them, and serves short-lived access tokens
to the gateway.
On downstream 401: one forced refresh + retry; if it still fails mark
reauth_required and show it in the console.
SSRF protection for all configurable URLs (block
private/link-local/metadata IP ranges unless explicitly allowlisted;
re-check after DNS resolution).

9. Logs and telemetry

Gateway -> console (automatic)

One structured event per request: event_id, timestamp, project,
mcp_server, tool, client_id, status, latency, bytes in/out, trace_id,
error.
Payload bodies off by default; configurable redaction rules when enabled.
In-memory ring buffer, batch by size/time, gzip, retry with backoff +
jitter, disk spool with size cap and drop policy when ingest is
unreachable.
Emit OpenTelemetry traces/metrics; local Prometheus /metrics.

Client -> ingest (no UI)

Separate service/host: POST /ingest/v1/logs, POST /ingest/v1/telemetry
(OTLP/HTTP-compatible preferred).
Auth: per-project ingest key or client token.
Enforce payload size limit, schema validation, per-key rate limit.
Return 202 after enqueue.
No read endpoints, no UI on this service.
Idempotent by event_id. Consumers drain the queue into the log store.
Retention policy and partitioning on the log store.

10. Production-grade / concurrency requirements (Kong-like)

Gateway

Non-blocking I/O, goroutine-per-request, HTTP/2 + connection pooling
to downstreams.
Stateless; shared state in Redis (local fallback if Redis is down).
Per-request and per-downstream timeouts, max in-flight cap with load
shedding (429/503 + Retry-After).
Rate limiting/quotas per project, client, and tool (token bucket).
Middleware chain: request-id -> inbound auth -> rate limit -> policy
-> route -> downstream -> log.
Hot config reload, TLS/mTLS, request size limits, graceful shutdown
with connection draining, /healthz and /readyz.

Console / ingest

Stateless API, DB pooling, optimistic locking on config writes,
migrations as a separate job.
Queue-based ingest so spikes never block gateways or the UI.
Backups, indexes, partitioned logs.

Targets to verify in load tests (adjust with owner)

Gateway added latency < 10 ms p95.
Thousands of concurrent MCP sessions per gateway instance.
Ingest >= 10k events/sec with the queue absorbing bursts.
A failing downstream or project must not degrade other projects.

11. Build phases

Phase 1 - Foundation Monorepo, DB schema + migrations, console auth,
Docker Compose (console, ingest, gateway, Postgres, Redis,
ClickHouse), CI per component. Acceptance: docker compose up starts
all services; console login works.

Phase 2 - Projects + MCP servers CRUD API/UI, connection test, tool
discovery, tool enable/disable. Acceptance: create a project, add 2
mock MCP servers, see discovered tools.

Phase 3 - Gateway core Gateway registration + secret auth, config
polling (long-poll + ETag), atomic swap, disk persistence, heartbeat,
project routing. Acceptance: config change in console reaches gateway
in < 5 s; gateway keeps serving after console is killed and restarted.

Phase 4 - MCP aggregation initialize/list/call fan-out, namespacing,
pooling, error normalization, partial-failure handling. Acceptance: a
standard MCP client connected to /p/{slug}/mcp sees one server with
all tools and can call tools on every downstream.

Phase 5 - OAuth Client credentials in gateway; auth-code + PKCE in
console with token endpoint for the gateway; inbound bearer validation
against external IdP; reauth-required status. Acceptance: verified end
to end against a real or mock IdP (e.g. Keycloak) for both grants.

Phase 6 - Logs + ingest Gateway batching/spooling, ingest service,
queue consumers, log store, console log viewer, client-facing ingest
endpoint. Acceptance: every gateway request appears in the console log
viewer; events survive an ingest outage via spool; ingest exposes no
UI/read routes.

Phase 7 - Hardening Rate limits, circuit breakers, load shedding,
metrics, OTel, graceful shutdown, secret rotation, audit log, SSRF and
security tests. Acceptance: security checklist (section 12) passes.

Phase 8 - Load + chaos testing k6/Vegeta scenarios; kill downstreams,
console, Redis, and ingest mid-load. Acceptance: section 10 targets
met; fail-static and isolation behaviors verified.

Phase 9 - Packaging + docs Helm charts (HPA on CPU + in-flight
requests), runbooks, OpenAPI docs, architecture docs,
upgrade/migration guide.

12. Security checklist

Secrets encrypted at rest; never logged or returned by APIs.
Gateway secret and API keys hashed; rotation and revocation supported.
OAuth: state + PKCE, exact redirect URI match, short token TTLs,
refresh tokens stay in console.
SSRF guard on all user-configurable URLs.
Payload logging off by default; redaction supported.
Input validation and size limits on every endpoint; ingest rate-limited per key.
TLS everywhere; mTLS optional between gateway and console.
Audit log for all console mutations.
Dependency and container image scanning in CI.

13. Testing strategy

Unit tests per component; contract tests against the OpenAPI/event
schemas in /shared.
Integration tests with mock downstream MCP servers and a mock IdP.
E2E: console -> gateway -> downstream -> logs visible in console.
Failure-injection tests (see Phase 8).
Load tests tracked in CI as a nightly job with regression thresholds.

14. Open questions for the owner

Confirm stack defaults (section 0).
Auth-code flow: per project (default) or per end user?
Need stdio downstream MCP servers later?
Single-org (default) or multi-tenant SaaS?
Log retention period and PII/redaction requirements?
Target cloud / Kubernetes environment and KMS provider?