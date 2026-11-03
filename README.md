# AI Gateway & Observability Platform (`AIGateway`)

[![CI/CD Pipeline](https://github.com/hibishtbobby17-ux/AIGateway/actions/workflows/ci.yaml/badge.svg)](https://github.com/hibishtbobby17-ux/AIGateway/actions/workflows/ci.yaml)
[![Release Pipeline](https://github.com/hibishtbobby17-ux/AIGateway/actions/workflows/release.yaml/badge.svg)](https://github.com/hibishtbobby17-ux/AIGateway/actions/workflows/release.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-green.svg)](SECURITY.md)

A high-performance enterprise AI gateway and observability platform unifying the **Model Context Protocol (MCP)**, the **Agent-to-Agent (A2A)** protocol, and a **Universal Multi-Cloud LLM Gateway** with enterprise identity (OAuth 2.1 PKCE / OIDC), AI guardrails, FinOps token attribution, fine-grained RBAC/ABAC access control, distributed tracing, and resilient outbound networking.

---

## Table of Contents
1. [Key Features](#key-features)
2. [Platform Portals & Network Endpoints](#platform-portals--network-endpoints)
3. [Prerequisites](#prerequisites)
4. [Deployment Modes](#deployment-modes)
   - [Mode 1: Docker Compose (Local Dev & Evaluation)](#mode-1-docker-compose-local-dev--evaluation)
   - [Mode 2: Kubernetes Umbrella Helm Release (Production HA)](#mode-2-kubernetes-umbrella-helm-release-production-ha)
   - [Mode 3: Standalone Native Binaries & Systemd (Edge / VM)](#mode-3-standalone-native-binaries--systemd-edge--vm)
   - [Mode 4: Pluggable Telemetry & Audit Sinks (ClickHouse / OpenSearch / S3 / OTLP)](#mode-4-pluggable-telemetry--audit-sinks)
5. [How Consumers Consume the Platform](#how-consumers-consume-the-platform)
   - [1. Universal LLM Gateway (OpenAI SDK, LangChain, LlamaIndex)](#1-universal-llm-gateway-openai-sdk-langchain-llamaindex)
   - [2. Model Context Protocol (Claude Desktop, Cursor, AI IDEs)](#2-model-context-protocol-claude-desktop-cursor-ai-ides)
   - [3. Autonomous Multi-Agent Systems (A2A Protocol)](#3-autonomous-multi-agent-systems-a2a-protocol)
   - [4. Enterprise Authentication (OAuth 2.1 PKCE & API Keys)](#4-enterprise-authentication-oauth-21-pkce--api-keys)
6. [Architecture & Documentation Index](#architecture--documentation-index)
7. [Verification & Health Checks](#verification--health-checks)
8. [CI/CD Pipeline, Security & Bug Reporting, and License](#cicd-pipeline-security--bug-reporting-and-license)

---

## Key Features

- **Universal Multi-Cloud LLM Gateway**: Exposes standard OpenAI-compatible endpoints (`/api/llm/{slug}/v1/chat/completions`) routing across Azure OpenAI, AWS Bedrock, OpenAI Direct, and Anthropic Claude with automatic latency-based failover, circuit breakers, and cost attribution.
- **Model Context Protocol (MCP) Gateway**: Aggregates downstream tool servers behind a unified endpoint with namespace prefixing, schema virtualization, and SSRF-safe egress dialers.
- **Agent-to-Agent (A2A) Gateway**: Standardized agent discovery via Agent Cards, task lifecycle state machines, SSE status streaming, and distributed trace context propagation.
- **Enterprise IAM & Security**: Built-in OAuth 2.1 / OIDC identity provider with PKCE S256, confidential client credentials, external IdP federation (Okta, Auth0, Microsoft Entra ID), AES-256-GCM secret encryption, and strict RBAC/ABAC policy evaluation.
- **Pluggable Telemetry Storage Sinks**: Choose your telemetry and audit log backend at deployment time (**ClickHouse OLAP**, **AWS OpenSearch Service**, **AWS S3 Data Lake with Parquet**, or **OpenTelemetry OTLP Collector**).
- **Dual-Plane Architecture**: Stateless, headless Go data-plane gateways with in-memory caching decoupled from the Next.js control plane.

---

## Platform Portals & Network Endpoints

| Portal / Service | Default URL | Purpose | Authentication |
| :--- | :--- | :--- | :--- |
| **Control Plane & Console** | `http://localhost:3000` | Management UI, Project configs, Gateway fleet, MCP catalog, LLM Gateways, and Deploy generator | Admin Cookie / Session (`admin@aigateway.local` / `Admin123!@#`) |
| **Data Plane Gateway** | `http://localhost:8080` | High-throughput data-plane proxy handling MCP tool calls, A2A tasks, and LLM completions | Bearer JWT / API Key / Gateway Secret |
| **Telemetry Ingest Service** | `http://localhost:8082` | High-speed telemetry collector buffering spans to ClickHouse, OpenSearch, S3, or OTLP | Internal network / Gateway Token |
| **PostgreSQL Database** | `localhost:5432` | Relational store for projects, policies, server metadata, and user accounts | Username & Password |
| **Redis Cache** | `localhost:6379` | Distributed token caching, rate-limiting counters, and session state | Optional password |
| **ClickHouse OLAP** | `localhost:8123` (HTTP) / `9000` (Native) | Columnar analytics database storing execution traces, tokens, and audit logs | Username & Password |

---

## Prerequisites

### Local Development / Evaluation
- **Docker Desktop** (v24+) or **Podman** with Compose v2.
- **Go** 1.22+ (for building native gateway binaries).
- **Node.js** 20+ and **npm** 10+ (for developing the console).
- **Git** and `curl`.

### Production Kubernetes (Cloud)
- **Kubernetes Cluster**: v1.26+ (AWS EKS, GCP GKE, Azure AKS, or bare metal).
- **Helm**: v3.12+.
- **Ingress Controller**: `ingress-nginx`, AWS Load Balancer Controller, or Traefik.
- **TLS Automation**: `cert-manager` with Let's Encrypt or corporate CA.
- **Persistent Databases**:
  - Managed PostgreSQL 15+ (e.g. AWS Aurora PostgreSQL, GCP Cloud SQL).
  - Managed Redis 7+ (e.g. AWS ElastiCache, GCP Cloud Memorystore).
  - Telemetry Sink (Managed ClickHouse Cloud, AWS OpenSearch Service, or AWS S3 Bucket).
- **External Identity Provider (Optional)**: Okta, Microsoft Entra ID, or Auth0 for enterprise SSO.

---

## Deployment Modes

### Mode 1: Docker Compose (Local Dev & Evaluation)

Docker Compose starts the entire platform stack in containers with one command:

```bash
# 1. Clone repository
git clone https://github.com/hibishtbobby17-ux/AIGateway.git
cd AIGateway

# 2. Initialize environment variables
cp .env.example .env

# 3. Launch full stack in background
docker compose up -d

# 4. Check container health status
docker compose ps
```

#### Accessing Services
- Open Management Console: **`http://localhost:3000`**
- Default Admin Credentials:
  - **Email**: `admin@aigateway.local`
  - **Password**: `Admin123!@#`
- Verify Gateway Health: `curl http://localhost:8080/healthz`
- Verify Ingest Health: `curl http://localhost:8082/healthz`

---

### Mode 2: Kubernetes Umbrella Helm Release (Production HA)

For cloud production environments, use the single umbrella Helm chart ([`deployments/helm/ai-gateway-platform`](deployments/helm/ai-gateway-platform)):

```bash
# 1. Add namespace
kubectl create namespace ai-platform

# 2. Deploy or upgrade the complete platform
helm upgrade --install ai-gateway ./deployments/helm/ai-gateway-platform \
  --namespace ai-platform \
  --values my-production-values.yaml \
  --wait \
  --timeout 10m
```

#### Sample Production `my-production-values.yaml`:
```yaml
global:
  environment: production

# Data-Plane Gateway Autoscaling
gateway:
  replicaCount: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 30
    targetCPUUtilizationPercentage: 70
  resilience:
    defaultUpstreamTimeoutMs: 15000
    defaultConcurrencyLimit: 500

# Control Plane & Console
controlPlane:
  replicaCount: 2
  resources:
    requests:
      cpu: 250m
      memory: 512Mi

# Production Managed PostgreSQL
database:
  internal:
    enabled: false
  external:
    host: "postgres-ha.database.svc.cluster.local"
    port: 5432
    database: "gateway_prod"
    user: "gateway_admin"
    existingSecret: "gateway-db-credentials"
    sslmode: "require"

# Telemetry Storage Sink Configuration (ClickHouse / OpenSearch / S3 / OTLP)
telemetry:
  sink: "clickhouse" # options: clickhouse | opensearch | s3 | otlp
  clickhouse:
    url: "https://clickhouse-prod.internal:8443/gateway_telemetry"

# Ingress & Automated TLS
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    gateway:
      host: "gateway.company.com"
      paths: [{ path: /, pathType: Prefix }]
    console:
      host: "console.company.com"
      paths: [{ path: /, pathType: Prefix }]
  tls:
    enabled: true
    secretName: "ai-gateway-tls-cert"
```

---

### Mode 3: Standalone Native Binaries & Systemd (Edge / VM)

For bare metal or edge virtual machines, compile native Go static binaries:

```bash
# 1. Build all platform binaries
make build
# Produces: bin/gateway, bin/control-plane, bin/migrate

# 2. Run Database Migrations
export GATEWAY_DATABASE_URL="postgres://user:password@db-host:5432/gateway_prod?sslmode=require"
./bin/migrate -direction=up

# 3. Run Gateway Data Plane
./bin/gateway \
  --id="gateway-edge-01" \
  --secret="sec_0123456789abcdef0123456789abcdef" \
  --console-url="https://console.company.com" \
  --ingest-url="https://ingest.company.com" \
  --port=8080
```

#### Systemd Service Unit (`/etc/systemd/system/ai-gateway.service`):
```ini
[Unit]
Description=AI Gateway Data Plane
After=network.target

[Service]
Type=simple
User=gateway
WorkingDirectory=/opt/ai-gateway
ExecStart=/opt/ai-gateway/bin/gateway -config /etc/ai-gateway/gateway.prod.yaml
Restart=always
RestartSec=5s
LimitNOFILE=65536
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
```

---

### Mode 4: Pluggable Telemetry & Audit Sinks

You can select your telemetry and audit log backend at deployment time:

#### 1. ClickHouse OLAP (Recommended for High QPS & FinOps)
* **Best for**: Sub-second SQL queries, 85–90% columnar compression, real-time token/cost attribution.
* **Helm Flag**: `--set telemetry.sink="clickhouse" --set telemetry.clickhouse.url="http://clickhouse:8123"`
* **Env Variable**: `TELEMETRY_SINK=clickhouse` and `CLICKHOUSE_URL=http://clickhouse:8123`

#### 2. AWS OpenSearch / Elasticsearch (Managed Search & Dashboards)
* **Best for**: Lexical text indexing over raw prompts, tool calls, and Kibana/OpenSearch Dashboards.
* **Helm Flag**: `--set telemetry.sink="opensearch" --set telemetry.opensearch.endpoint="https://search-corp.us-east-1.es.amazonaws.com"`
* **Env Variable**:
  ```ini
  TELEMETRY_SINK=opensearch
  OPENSEARCH_URL=https://search-corp.us-east-1.es.amazonaws.com
  OPENSEARCH_INDEX=ai-gateway-telemetry
  AWS_REGION=us-east-1
  ```

#### 3. AWS S3 Data Lake (Lowest Cost & Long-Term Archival)
* **Best for**: Storing compressed Apache Parquet or `.json.gz` micro-batches directly in S3. Zero database compute costs; queryable on-demand via **AWS Athena** or **Snowflake**.
* **Helm Flag**: `--set telemetry.sink="s3" --set telemetry.s3.bucket="my-corp-ai-audit-logs" --set telemetry.s3.region="us-east-1" --set telemetry.s3.format="parquet"`
* **Env Variable**:
  ```ini
  TELEMETRY_SINK=s3
  S3_BUCKET=my-corp-ai-audit-logs
  AWS_REGION=us-east-1
  S3_PREFIX=telemetry/v1/
  S3_OUTPUT_FORMAT=parquet
  S3_FLUSH_INTERVAL=60s
  ```

#### 4. OpenTelemetry (OTLP Collector / Enterprise APM)
* **Best for**: Forwarding telemetry to Datadog, Dynatrace, New Relic, Splunk, or Honeycomb.
* **Helm Flag**: `--set telemetry.sink="otlp" --set telemetry.otlpEndpoint="http://otel-collector:4318/v1/traces"`
* **Env Variable**: `TELEMETRY_SINK=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces`

---

## How Consumers Consume the Platform

### 1. Universal LLM Gateway (OpenAI SDK, LangChain, LlamaIndex)

Consumer applications use standard OpenAI SDKs or HTTP clients. Simply point `base_url` to the gateway's slug-based endpoint. The gateway handles Okta OAuth / API-key verification, token metering, and multi-cloud routing across Azure OpenAI, AWS Bedrock, Anthropic, and OpenAI Direct.

#### Python (Official `openai` SDK):
```python
import os
from openai import OpenAI

client = OpenAI(
    # Point to the AI Gateway Universal LLM endpoint
    base_url="http://localhost:3000/api/llm/enterprise-chat/v1",
    api_key=os.environ.get("GATEWAY_API_KEY", "ak_live_a1b2c3d4e5f60718293a4b5c")
)

response = client.chat.completions.create(
    model="gpt-4o",  # Transparently routes to Azure OpenAI or AWS Bedrock
    messages=[
        {"role": "system", "content": "You are an enterprise AI assistant."},
        {"role": "user", "content": "Analyze our Q3 cloud infrastructure spend."}
    ],
    temperature=0.2
)

print(response.choices[0].message.content)
```

#### TypeScript / Node.js:
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3000/api/llm/enterprise-chat/v1',
  apiKey: process.env.GATEWAY_API_KEY || 'ak_live_a1b2c3d4e5f60718293a4b5c',
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Summarize customer feedback ticket #4092' }],
  });
  console.log(completion.choices[0].message.content);
}

main();
```

#### cURL:
```bash
curl -X POST "http://localhost:3000/api/llm/enterprise-chat/v1/chat/completions" \
  -H "Authorization: Bearer ak_live_a1b2c3d4e5f60718293a4b5c" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Health check query"}],
    "temperature": 0.7
  }'
```

---

### 2. Model Context Protocol (Claude Desktop, Cursor, AI IDEs)

The gateway aggregates dozens of backend MCP tool servers (Postgres, Jira, GitHub, Slack) into a single virtualized tool catalog with project-scoped authorization.

#### Claude Desktop Configuration (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "enterprise-gateway": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sse",
        "--url",
        "http://localhost:8080/api/mcp/project-alpha-01/sse",
        "--header",
        "Authorization: Bearer ak_live_a1b2c3d4e5f60718293a4b5c"
      ]
    }
  }
}
```

#### Listing Virtualized Tools via cURL:
```bash
curl -X POST "http://localhost:8080/api/mcp/project-alpha-01/rpc" \
  -H "Authorization: Bearer ak_live_a1b2c3d4e5f60718293a4b5c" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

---

### 3. Autonomous Multi-Agent Systems (A2A Protocol)

Autonomous multi-agent workflows (e.g. LangGraph, CrewAI, AutoGen) communicate across organizational boundaries using the Agent-to-Agent (A2A) protocol.

#### Discovering Downstream Agent Cards:
```bash
curl -X GET "http://localhost:8080/api/a2a/project-alpha-01/cards" \
  -H "Authorization: Bearer ak_live_a1b2c3d4e5f60718293a4b5c"
```

#### Dispatching a Collaborative Task:
```bash
curl -X POST "http://localhost:8080/api/a2a/project-alpha-01/tasks" \
  -H "Authorization: Bearer ak_live_a1b2c3d4e5f60718293a4b5c" \
  -H "Content-Type: application/json" \
  -d '{
    "target_agent_id": "agent-financial-auditor",
    "delegation_mode": "asynchronous",
    "task_type": "audit_reconciliation",
    "payload": {
      "quarter": "Q3",
      "currency": "USD"
    }
  }'
```

---

### 4. Enterprise Authentication (OAuth 2.1 PKCE & API Keys)

The platform supports multiple authentication methods:

1. **API Keys**: Fast, secure consumer integration via `Authorization: Bearer ak_live_...` or `X-API-Key: ak_live_...`.
2. **OAuth 2.1 Client Credentials (M2M)**: Enterprise backend services request tokens from Okta or the Gateway IdP:
   ```bash
   curl -X POST "http://localhost:3000/api/mock/idp/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials&client_id=client_corp_app&client_secret=secret_xyz"
   ```
3. **OAuth 2.1 with PKCE (Interactive Web & SPA)**: For frontends and IDE plugins authenticating interactive users via Okta/Entra ID SSO with S256 code challenge.

---

## Architecture & Documentation Index

All architectural designs, threat models, and operational specifications are stored in [`/docs`](docs):

- **[System Architecture Overview](docs/architecture/overview.md)**: C4 Level 1 & 2 diagrams, trust boundaries, and network flows.
- **[Component Dependencies](docs/architecture/component-dependencies.md)**: Package structures and dependency boundaries.
- **[Domain Model & Persistence](docs/architecture/domain-model.md)**: Database ERD, schemas, and task state machines.
- **[Security Risk Register](docs/security/risk-register.md)**: STRIDE threat model, SSRF egress protections, and cryptographic standards.
- **[Deployment & Operations Guide](docs/operations/deployment-guide.md)**: In-depth production runbooks, HA clustering, and zero-downtime rolling upgrades.
- **[Architecture Decision Records (ADRs)](docs/adr)**: ADR-0001 through ADR-0009 covering transports, persistence, and resilience.

---

## Verification & Health Checks

Verify operational status across all services:

```bash
# 1. Console & Control Plane Probe
curl -I http://localhost:3000/api/healthz

# 2. AI Gateway Data Plane Probe
curl -I http://localhost:8080/healthz

# 3. Telemetry Ingest Service Probe
curl -I http://localhost:8082/healthz

# 4. Run Automated Gateway Test Suite
go test -v ./gateway/... ./ingest/... ./internal/... ./shared/... ./tests/...
node tests/integration/verify_llm_gateway.cjs
node tests/integration/verify_deploy_and_mcp.cjs
```

---

## CI/CD Pipeline, Security & Bug Reporting, and License

- **CI/CD & Release Pipeline**: Automated 4-stage pipeline ([`.github/workflows/ci.yaml`](.github/workflows/ci.yaml) and [`.github/workflows/release.yaml`](.github/workflows/release.yaml)) executing **Build** -> **Security Scanning** (`go vet`, `govulncheck`, Trivy FS scan, `npm audit`) -> **Regression & QA Testing** (Unit, Security, Resilience, Integration, Helm Smoke) -> **GitHub Release Creation**.
- **Report a Bug**: Open a structured [Bug Report](https://github.com/hibishtbobby17-ux/AIGateway/issues/new?template=bug_report.md) via [`.github/ISSUE_TEMPLATE/bug_report.md`](.github/ISSUE_TEMPLATE/bug_report.md).
- **Security Policy & Vulnerability Reporting**: Review [`SECURITY.md`](SECURITY.md) or submit a [Security Report](https://github.com/hibishtbobby17-ux/AIGateway/issues/new?template=security_report.md) / [Private Security Advisory](https://github.com/hibishtbobby17-ux/AIGateway/security/advisories/new).
- **Code Ownership & Branch Protection**: All changes to `main` require a Pull Request ([`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)) and explicit review approval from `@hibishtbobby17-ux` ([`.github/CODEOWNERS`](.github/CODEOWNERS)).
- **License**: Licensed under the **[MIT License](LICENSE)**.
