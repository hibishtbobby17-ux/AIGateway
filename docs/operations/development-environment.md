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

### 2.1 Configuration
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
GATEWAY_JWT_ISSUER=https://gateway.local
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

### 2.2 Local Storage Services (Docker Compose)
A minimal compose file (`deployments/compose/docker-compose.dev.yaml`) provides local backing services:
- **PostgreSQL 16**: Port `5432`
- **ClickHouse**: Ports `8123` (HTTP) and `9000` (Native)
- **Jaeger / OpenTelemetry Collector**: Port `16686` (UI) and `4317`/`4318` (OTLP)

---

## 3. Testing & Verification Plan

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
