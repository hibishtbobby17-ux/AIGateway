# AI Gateway and Observability Platform: Release Checklist & Known Limitations

This document establishes the pre-flight verification gates, release qualification checklist, and documented operational limitations for publishing and deploying version 1.0.0 of the platform.

---

## 1. Pre-Flight Qualification Gates

Before any production release artifact is tagged or deployed:

### Code Quality & Static Analysis
- [x] Strict formatting and linting pass with zero warnings (`go vet ./...` and `golangci-lint run`).
- [x] Go module dependencies verified, vetted, and clean (`go mod tidy` and `go mod verify`).
- [x] No unacknowledged TODOs, debug code, or mock placeholders in production code paths.

### Automated Testing Gates
- [x] **Unit & Integration Suite**: Complete package test pass with race detector enabled (`go test -race ./...`).
- [x] **Security Test Suite**: SSRF mitigation, token signature verification, durable revocation checks, PKCE S256 enforcement, and cross-tenant isolation tests pass (`tests/security/...`).
- [x] **Resilience & Chaos Suite**: Bounded concurrency bulkheads, circuit breakers, rate limiting, and failure injection tests pass (`tests/resilience/...`).
- [x] **Load & Benchmark Suite**: High-concurrency load testing confirms zero goroutine leaks and bounded memory under sustained pressure (`tests/load/...`).
- [x] **Deployment Smoke Tests**: Helm lint, template rendering with overrides, probe lifecycle, zero-downtime rolling upgrades, and DB backup verification pass (`tests/deployment/...`).

---

## 2. Release Packaging Checklist

| Step | Action | Responsible / Tool | Status |
| :--- | :--- | :--- | :--- |
| **1. Binaries** | Compile static Linux/macOS/Windows binaries for `gateway`, `control-plane`, and `migrate` | `make build` | Complete |
| **2. Containers** | Build, vulnerability scan, and tag multi-stage container images | Docker Buildx / Trivy | Complete |
| **3. Helm Chart** | Lint umbrella chart, package `.tgz`, and verify `Chart.yaml` version alignment | `helm lint` & `helm package` | Complete |
| **4. Database** | Verify forward and rollback migration SQL scripts on clean Postgres instance | `migrate -direction=up` / `down` | Complete |
| **5. Configuration** | Validate strict production YAML configurations reject insecure settings | `tests/deployment` | Complete |
| **6. Documentation** | Ensure deployment guides, runbooks, ADRs, and release notes are updated | `/docs` | Complete |

---

## 3. Documented Known Limitations & Operational Constraints

In accordance with `PROJECT_INTENT.md` and Architecture Decision Records (ADRs), operators must be aware of the following known limitations:

### 1. Key Encryption Key Synchronization Across Replicas
- **Limitation**: When running multiple replicas of the gateway or control plane, all pods must share the identical 32-byte (64 hex character) AES-256 master signing key encryption key (`GATEWAY_SIGNING_KEY_ENCRYPTION_KEY`).
- **Mitigation**: In Kubernetes, provision this key through a shared Kubernetes `Secret` (`existingSecret`) or an enterprise external secrets operator (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager). Replicas automatically decrypt shared active signing keys stored in PostgreSQL.

### 2. Durable Token Revocation Requires Shared SQL Connectivity
- **Limitation**: To prevent replay of revoked JWT access tokens or terminated OAuth sessions across distributed nodes, token verification enforces durable revocation lookups against PostgreSQL.
- **Operational Requirement**: If the primary database is completely partitioned or unreachable, token verification fails closed for unverified sessions to preserve zero-trust boundaries.

### 3. Built-in Identity Provider vs. Enterprise OIDC Federation
- **Limitation**: The built-in IdP (`internal/identity/idp`) provides standard username/password authentication, PKCE consent workflows, and JWT issuance for internal workloads, CLI clients, and development/testing environments.
- **Guidance**: For large enterprise production environments with thousands of corporate users, organization single sign-on (SSO) should be federated with external OIDC providers (Okta, Auth0, Microsoft Entra ID) using the configured federation handlers (`internal/identity/oidc`).

### 4. Remote Tool Execution Network Uncertainty
- **Limitation**: MCP tool calls and A2A agent delegations over remote HTTP/SSE connections cannot guarantee exactly-once execution during transient network dropouts.
- **Guidance**: As outlined in ADR-0008 and `PROJECT_INTENT.md`, retry policies apply exponential backoff with full jitter and deadline budgets, but non-idempotent tool invocations (e.g. POST endpoints without idempotency keys) are not automatically retried after transport failures. Upstream servers should support idempotency keys for mutative operations.

### 5. Outbound Egress & Private Network Whitelisting
- **Limitation**: By default, production configurations strictly forbid outbound egress to loopback and private IPv4/IPv6 address spaces (`127.0.0.0/8`, `169.254.169.254`, `10.0.0.0/8`, etc.) to eliminate Server-Side Request Forgery (SSRF) and cloud metadata exfiltration.
- **Configuration**: If upstream MCP servers or A2A agents run inside internal VPCs, administrators must explicitly declare permitted subnets in `security.egress_allowed_cidrs`.

---

## 4. Release Verification Sign-Off

- **Target Version**: `v1.0.0`
- **Release Status**: **Production Ready**
- **Architecture Integrity**: All acceptance criteria for Milestones 0 through 8 in `IMPLEMENTATION_PLAN.md` are satisfied, verified, and documented.
