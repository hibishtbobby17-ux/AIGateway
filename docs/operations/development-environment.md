# Development Environment & Operations Plan

## 1. Host Environment Discovery & Baseline

During Milestone 0 inspection, the local environment was evaluated:
- **Operating System**: Windows (PowerShell environment)
- **Version Control**: Git 2.56.0 is available at `C:\Program Files\Git\cmd\git.exe`
- **Package Manager**: Windows Package Manager (`winget`) is present
- **Application State**: Greenfield codebase containing `PROJECT_INTENT.md` and `IMPLEMENTATION_PLAN.md`

### Required Tooling for Implementation
To build and run the Go backend, migrations, and test suites across subsequent milestones:
1. **Go Toolchain**: Go 1.23+
   - Installation via winget: `winget install GoLang.Go.1.23` (or download official Windows MSI from https://go.dev)
2. **Container Engine**: Docker Desktop or Podman (for running PostgreSQL and ClickHouse in Docker Compose)
   - Alternatively: Local PostgreSQL 16 Windows service
3. **Node.js**: Node.js 20+ LTS & npm (for Web Management Console in Milestone 6)
   - Installation via winget: `winget install OpenJS.NodeJS.LTS`
4. **Git Path**: Ensure `C:\Program Files\Git\cmd` is configured in system `PATH` for standard command-line tools.

---

## 2. Monorepo Development Workflow

### 2.1 Prerequisites

Install Go 1.23+, Docker Desktop or Podman with Compose support, and Git. Node.js 20+ with npm is additionally required to work on the React/TypeScript console. A local Kubernetes distribution such as kind or minikube, together with Helm, is required to verify the Helm installation locally.

Run commands below from the repository root. The PowerShell examples use the same environment variable names on Windows; use the equivalent shell syntax on other operating systems.

### 2.2 Configuration
Configuration is loaded using a hierarchical provider:
1. Environment variables (prefixed with `GATEWAY_`)
2. Configuration file (`configs/gateway.yaml` or `configs/standalone.yaml`)
3. Built-in secure defaults

Example development environment file (`.env.example`):
```bash
# Server Configuration
GATEWAY_SERVER_PORT=8080
GATEWAY_ADMIN_PORT=8081
GATEWAY_LOG_LEVEL=debug
GATEWAY_ENVIRONMENT=development

# Security
GATEWAY_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
# Required only when enabling persistent OAuth signing keys. Keep out of config files and share securely across replicas.
GATEWAY_SIGNING_KEY_ENCRYPTION_KEY=<64-character-hex-secret-from-a-secret-manager>
GATEWAY_JWT_ISSUER=https://gateway.local
GATEWAY_JWT_AUDIENCE=gateway-api
GATEWAY_ALLOW_LOCAL_EGRESS=true # Only in local development

# Primary Database
GATEWAY_DATABASE_URL=postgres://gateway:gateway@localhost:5432/gateway_dev?sslmode=disable
GATEWAY_DATABASE_MAX_CONNS=25
GATEWAY_DATABASE_MIN_CONNS=5

# Telemetry
GATEWAY_OTLP_HTTP_PORT=4318
GATEWAY_OTLP_GRPC_PORT=4317
GATEWAY_CLICKHOUSE_URL=http://localhost:8123/default
```

Generate a local-only key in PowerShell (do not use this generated value in production):

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:GATEWAY_SIGNING_KEY_ENCRYPTION_KEY = [Convert]::ToHexString($bytes).ToLowerInvariant()
```

The signing-key encryption value is intentionally excluded from serialized config. Production deployments must inject the same randomly generated 32-byte key into every replica via a secret manager; losing or changing it makes previously persisted private signing keys unreadable.

### 2.3 Local Storage Services (Docker Compose)
A minimal compose file (`deployments/compose/docker-compose.dev.yaml`) provides local backing services:
- **PostgreSQL 16**: Port `5432`
- **ClickHouse**: Ports `8123` (HTTP) and `9000` (Native)
- **Jaeger / OpenTelemetry Collector**: Port `16686` (UI) and `4317`/`4318` (OTLP)

---

## 3. Deploy and Verify Locally

The following workflow runs the current Go gateway against the local PostgreSQL service. It is also the baseline that frontend, control-plane, and end-to-end tests must extend as those components are implemented.

1. Start the local backing services and wait for their health checks:

   ```powershell
   docker compose -f deployments/compose/docker-compose.dev.yaml up -d
   docker compose -f deployments/compose/docker-compose.dev.yaml ps
   ```

2. Configure the local database connection, then apply migrations:

   ```powershell
   $env:GATEWAY_DATABASE_DRIVER = "postgres"
   $env:GATEWAY_DATABASE_URL = "postgres://gateway:gateway@localhost:5432/gateway_dev?sslmode=disable"
   go run ./cmd/migrate -direction up
   ```

3. Run the automated Go tests:

   ```powershell
   go test ./...
   ```

4. Start the gateway in a separate terminal using the same database environment variables:

   ```powershell
   $bytes = New-Object byte[] 32
   [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   $env:GATEWAY_SIGNING_KEY_ENCRYPTION_KEY = [Convert]::ToHexString($bytes).ToLowerInvariant()
   $env:GATEWAY_JWT_ISSUER = "https://gateway.local"
   $env:GATEWAY_JWT_AUDIENCE = "gateway-api"
   go run ./cmd/gateway
   ```

   Use the same stable `GATEWAY_SIGNING_KEY_ENCRYPTION_KEY` on every restart and replica. The example above is for a disposable local database; reusing the same generated value is required to read keys already persisted in SQL. Do not generate a new value on every restart.

   The gateway now validates bearer tokens and loads persisted tenant policies at startup. With no policy rows, MCP operations are denied by default. The OAuth provider is not mounted yet, so the current repository does not expose a supported runtime flow for obtaining gateway tokens.

5. In another terminal, verify the gateway is serving its health and root endpoints:

   ```powershell
   Invoke-WebRequest http://localhost:8080/healthz
   Invoke-WebRequest http://localhost:8080/readyz
   Invoke-RestMethod http://localhost:8080/
   ```

   `/healthz` and `/readyz` should return HTTP 200 when the service and database are healthy. The root endpoint should report the platform as online. Protocol and upstream-routing behavior is verified by the automated MCP integration tests; a live communication graph is only meaningful once telemetry-backed topology is implemented.

6. Open Jaeger at `http://localhost:16686` to inspect locally exported traces when telemetry instrumentation/export is available.

Stop the backing services when finished:

```powershell
docker compose -f deployments/compose/docker-compose.dev.yaml down
```

The default `down` command preserves named database volumes. Do not use `-v` unless intentionally discarding local database and ClickHouse data.

### 3.1 Local frontend and Helm deployment verification

When the console and platform Helm chart are implemented, extend this workflow with repeatable automated checks that:

- Start the frontend with the documented local development command and verify the application loads and can authenticate against the local management API.
- Exercise server/agent configuration, configured topology, and telemetry-backed observed interactions using test fixtures or disposable local services; assert that the UI shows backend data and distinguishes configured from observed connections.
- Deploy the complete platform to a disposable kind or minikube cluster using the documented single-chart, single-`helm install` procedure, wait for all required workloads to become ready, and smoke-test the frontend and gateway endpoints.
- Clean up the local Helm release and cluster resources without requiring separate installation steps for first-party platform components.

Keep these local checks runnable from a clean checkout and document required environment variables, expected endpoints, and failure diagnostics. Do not mark local deployment or end-to-end acceptance criteria complete based on unit tests alone.

---

## 4. Testing & Verification Plan

The platform enforces a multi-tier testing strategy:
1. **Unit Tests**:
   - Package-level unit tests testing domain logic, token validation, policy evaluations, and SSRF dialer rules in isolation.
   - Command: `go test -v -race ./internal/...`
2. **Integration Tests**:
   - Tests requiring PostgreSQL running migrations and testing transactional repository behavior.
   - Run with Dockerized test database: `go test -v -tags=integration ./tests/integration/...`
3. **Protocol Conformance Tests**:
   - Dedicated MCP client test harness verifying JSON-RPC 2.0 and SSE transports against mock upstreams.
   - A2A test harness verifying Agent Card schema validation and task lifecycle transitions.
4. **Security Regression Tests**:
   - Automated SSRF tests attempting dials to prohibited IPs.
   - Cross-tenant permission escalation tests.
   - Secret redaction verification on logs and spans.
5. **Static Analysis & Linting**:
   - `golangci-lint run`
   - `gosec -quiet ./...`
   - `govulncheck ./...`
6. **Local deployment smoke tests**:
   - Start dependencies with the documented Compose workflow and verify migrations, service health, and gateway responses.
   - Once available, run frontend end-to-end tests and install/smoke-test the complete chart in a disposable local Kubernetes cluster.
