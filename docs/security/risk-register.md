# Security Risk Register & Threat Model

## 1. Security Architecture Principles

1. **Zero Trust at Network & Component Boundaries**: Never trust an inbound network caller, an upstream MCP server, or an external agent. Every request is authenticated and authorized at the point of ingress and invocation.
2. **Strict Dual-Phase Authorization**: Catalog visibility in discovery (`tools/list` or Agent Card inspection) does **not** equal authorization to execute. Execution (`tools/call` or `tasks/submit`) independently evaluates full RBAC/ABAC policies.
3. **SSRF & Egress Defense in Depth**: All outbound network dials from the Gateway are routed through a hardened egress dialer that enforces IP deny-lists (blocking RFC 1918, RFC 4193, cloud metadata `169.254.169.254`, loopback addresses) and mitigates DNS rebinding attacks.
4. **Token Isolation & Anti-Relay**: External client tokens are never blindly forwarded to upstream servers. Downstream calls use explicit upstream service credentials or securely exchanged downstream tokens with constrained audiences.
5. **Zero Plaintext Secrets**: Secrets (client secrets, private signing keys, upstream API keys) are encrypted with AES-256-GCM at rest, never logged, and redacted from distributed traces.
6. **Bounded Telemetry Resource Footprint**: Telemetry pipelines are strictly non-blocking and memory-bounded. Degradation of ClickHouse or Prometheus never exhausts Gateway memory or halts user traffic.

---

## 2. STRIDE Threat Model

| STRIDE Category | Threat Description | Affected Component | Mitigating Control |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Attacker impersonates a legitimate client or upstream agent. | Ingress API, A2A Gateway | Mandatory OAuth 2.1 authentication (PKCE S256 for public clients, client secrets / mTLS for confidential clients). Cryptographic signature verification on all JWTs. |
| **Tampering** | Interception or modification of tool calls or task streaming events in flight. | MCP & A2A Transports | TLS 1.3 enforced on all external endpoints. W3C Trace Context validation. Monotonic event sequence verification in A2A task streaming. |
| **Repudiation** | Client denies executing a privileged tool or administrative change. | Platform Control Plane | Tamper-evident, immutable Audit Log recording `actor_id`, `action`, `resource_id`, `client_ip`, timestamp, and outcome to PostgreSQL. |
| **Information Disclosure** | Leakage of cross-tenant data, internal infrastructure IPs, or API keys in error traces. | Multi-Tenant Database, Logging & Tracing | Row-level tenant filtering on all queries (`tenant_id = ?`). Automated telemetry redactor stripping `Authorization`, passwords, and API keys. Generic error responses to external callers. |
| **Denial of Service** | Upstream server hangs indefinitely, or an attacker floods gateway with large tool requests. | Egress Transport, Ingress Buffers | Strict request body size limits (e.g., max 2MB). Per-upstream concurrency bulkheads, circuit breakers, and bounded timeouts. Non-blocking bounded ring buffer for telemetry. |
| **Elevation of Privilege** | User authorized only for tool discovery bypasses check to execute dangerous tool. | Policy Engine | Independent authorization checks during execution (`tools/call`). Deny-by-default RBAC/ABAC evaluator. |

---

## 3. Comprehensive Risk Register

| Risk ID | Title | Inherent Risk | Description | Mitigating Controls | Residual Risk | Status |
| :--- | :--- | :---: | :--- | :--- | :---: | :---: |
| **SEC-01** | SSRF & Cloud Metadata Extraction | **CRITICAL** | Attacker registers an MCP server or A2A agent with URL pointing to `169.254.169.254` (AWS/GCP metadata) or internal RFC 1918 IPs. | Custom Go `net.Dialer` resolving DNS first, checking IP against private CIDR deny-list before dialing, blocking redirects, and disallowing loopback/link-local addresses. | LOW | Mitigated by Design |
| **SEC-02** | Cross-Tenant Data & Telemetry Bleed | **CRITICAL** | A client in Tenant A crafts an API query or trace search that returns data belonging to Tenant B. | Mandatory `tenant_id` column in all tables; query repository enforcing `WHERE tenant_id = ?` parameterization; telemetry ingestion tagging and tenant-scoped ClickHouse partition queries. | LOW | Mitigated by Design |
| **SEC-03** | Token Relay / Downstream Credential Theft | **HIGH** | Gateway forwards an incoming user's OAuth access token directly to an untrusted upstream MCP server, which abuses it against third-party APIs. | Upstream calls use dedicated upstream vault credentials or RFC 8693 OAuth 2.0 Token Exchange with explicit, constrained downstream `audience`. | LOW | Mitigated by Design |
| **SEC-04** | Telemetry Pipeline Denial of Service | **HIGH** | Influx of high-frequency tool calls fills telemetry queue, causing gateway to run out of memory or crash. | In-memory bounded ring buffer (e.g., max 10,000 events); automated load shedding with metric drop counter; telemetry failure never blocks gateway response path. | LOW | Mitigated by Design |
| **SEC-05** | Discovery vs. Execution Auth Drift | **HIGH** | Tool appears in catalog discovery, leading gateway to assume execution is pre-authorized. | Architectural invariant: `tools/call` and `tasks/submit` handlers invoke policy evaluation independently of discovery state. | VERY LOW | Mitigated by Design |
| **SEC-06** | Secret Exposure in Logs & Spans | **HIGH** | Sensitive API keys or tool parameters logged in plain text during debugging or error dumping. | Structured logging wrapper (`slog`) with custom field redactor; OpenTelemetry attribute sanitizer filtering keys matching `*auth*`, `*token*`, `*secret*`, `*password*`. | LOW | Mitigated by Design |
| **SEC-07** | Upstream Zombie Hang / Connection Starvation | **MEDIUM** | Slow or malicious upstream server holds open TCP connections without replying, exhausting gateway socket descriptors. | Bounded HTTP client timeouts (`ResponseHeaderTimeout`, `IdleConnTimeout`), context deadline enforcement, and per-upstream bulkhead concurrency limits. | LOW | Mitigated by Design |
| **SEC-08** | Malicious Payload / Deserialization Exploit | **MEDIUM** | Oversized or deeply nested JSON-RPC / SSE payloads crash JSON parser or consume excessive CPU. | Bounded `http.MaxBytesReader` (2MB limit); standard `encoding/json` with depth limits; JSON Schema validation prior to upstream dispatch. | LOW | Mitigated by Design |

---

## 4. Automated Security Verification Gates

To ensure no security regression enters the codebase, the following gates are integrated into the development lifecycle:
1. **Static Security Analysis**: `gosec` scanning for insecure cryptography, SQL injection, and weak random number generators.
2. **Dependency Vulnerability Scanning**: `govulncheck` and GitHub Dependabot / Trivy for known CVEs.
3. **Automated SSRF Suite**: Integration test suite verifying that attempts to register `http://169.254.169.254/latest/meta-data/`, `http://127.0.0.1:8080`, and `http://10.0.0.1/` are rejected with `400 Bad Request`.
4. **Cross-Tenant Test Suite**: Integration test verifying that a JWT issued for `tenant-1` cannot access resources, tools, tasks, or traces in `tenant-2`.
