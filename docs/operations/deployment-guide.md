# AI Gateway and Observability Platform: Deployment & Operations Guide

This guide provides authoritative operational instructions for deploying, configuring, upgrading, and troubleshooting the AI Gateway and Observability Platform in production across both standalone (Docker / Docker Compose) and clustered Kubernetes environments.

---

## 1. Architecture & Packaging Model

The platform follows a **single-release, independently scalable** deployment architecture. All components share identical configuration models and database schemas:

```
                      +---------------------------------------+
                      |       Ingress / Load Balancer         |
                      |        TLS Termination (443)          |
                      +-------------------+-------------------+
                                          |
                +-------------------------+-------------------------+
                |                                                   |
                v (Path: /mcp, /a2a, /oauth, /v1)                   v (Path: /admin, /api, /console)
   +----------------------------+                       +-----------------------------+
   |        AI Gateway          |                       |        Control Plane        |
   |   (Stateless, Replicated)  |                       |   (Embedded React Console)  |
   | Ports: 8080 (app), 9090 (m)|                       | Port: 8081 (admin & UI)     |
   +-------------+--------------+                       +--------------+--------------+
                 |                                                     |
                 +--------------------------+--------------------------+
                                            |
                         +------------------v------------------+
                         |        PostgreSQL Database          |
                         | (Multi-tenant, Migrations, State)   |
                         +------------------+------------------+
                                            |
                         +------------------v------------------+
                         |      ClickHouse / Jaeger / OTLP     |
                         |   (Telemetry & Distributed Traces)  |
                         +-------------------------------------+
```

### Components
1. **AI Gateway (`cmd/gateway`)**: Handles external MCP client tool aggregations and A2A agent delegations, OAuth 2.1/OIDC token issuance and authorization evaluation, and OTLP telemetry ingestion.
2. **Control Plane (`cmd/control-plane`)**: Serves the tenant administration REST API and hosts the embedded React/TypeScript management console and interactive communication topology graph.
3. **Migration Runner (`cmd/migrate`)**: Executes versioned SQL migrations (`migrations/*.sql`) to maintain durable schema consistency.

---

## 2. Standalone Binary Deployment

For lightweight or virtual machine deployments, compile and run the native static Go binaries.

### Prerequisites
- Go 1.22+
- PostgreSQL 15+ (with `sslmode=require` in production)
- ClickHouse 24+ (optional, for persistent trace and log telemetry)

### Compilation
```bash
make build
# Produces bin/gateway, bin/control-plane, bin/migrate, bin/dev-seed
```

### Step 1: Database Migration
Before starting service daemons, apply SQL schema migrations:
```bash
export GATEWAY_DATABASE_URL="postgres://user:password@postgres-host:5432/gateway_prod?sslmode=require"
export GATEWAY_DATABASE_DRIVER="postgres"
./bin/migrate -direction=up
```

### Step 2: Systemd Unit Files

Create `/etc/systemd/system/ai-gateway.service`:
```ini
[Unit]
Description=AI Gateway Service
After=network.target postgresql.service

[Service]
Type=simple
User=gateway
Group=gateway
WorkingDirectory=/opt/ai-gateway
ExecStart=/opt/ai-gateway/bin/gateway -config /etc/ai-gateway/gateway.prod.yaml
Restart=on-failure
RestartSec=5s
LimitNOFILE=65536
KillSignal=SIGTERM
TimeoutStopSec=30s

# Strict security hardening
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/ai-control-plane.service`:
```ini
[Unit]
Description=AI Control Plane & Management Console
After=network.target postgresql.service ai-gateway.service

[Service]
Type=simple
User=gateway
Group=gateway
WorkingDirectory=/opt/ai-gateway
ExecStart=/opt/ai-gateway/bin/control-plane -config /etc/ai-gateway/control-plane.prod.yaml
Restart=on-failure
RestartSec=5s
LimitNOFILE=65536
KillSignal=SIGTERM
TimeoutStopSec=30s

[Install]
WantedBy=multi-user.target
```

---

## 3. Docker & Docker Compose Deployment

The repository includes production-ready multi-stage Dockerfiles and a complete `docker-compose.yml` for unified local, test, or single-node production deployment.

### Quickstart
1. Navigate to the compose directory:
   ```bash
   cd deployments/compose
   cp .env.example .env
   ```
2. Generate secure 32-byte (64 hex character) keys for production:
   ```bash
   # Linux/macOS
   openssl rand -hex 32
   # Windows PowerShell
   -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
   ```
   Set `GATEWAY_ENCRYPTION_KEY` and `GATEWAY_SIGNING_KEY_ENCRYPTION_KEY` in `.env`.
3. Launch the platform:
   ```bash
   docker compose up -d
   ```
4. Verify service status and logs:
   ```bash
   docker compose ps
   docker compose logs -f gateway
   ```
5. Access endpoints:
   - AI Gateway: `http://localhost:8080`
   - Management Console: `http://localhost:8081`
   - Prometheus Metrics: `http://localhost:9090`
   - Jaeger Tracing UI: `http://localhost:16686`

---

## 4. Kubernetes Deployment via Single Umbrella Helm Chart

The standard production installation path on Kubernetes is the platform's umbrella Helm chart: `deployments/helm/ai-gateway-platform`.

> **Key Rule**: A standard deployment does **not** require installing separate charts for first-party platform components. All workloads (Gateway, Control Plane, Console, Database Migrations, and optional in-chart PostgreSQL) are managed through **one Helm release**.

### Prerequisites
- Kubernetes cluster v1.26+
- Helm 3.12+
- Ingress controller (e.g., ingress-nginx, AWS ALB, Traefik)
- Cert-Manager (recommended for automated TLS certificates)

### Standard Single-Command Installation

To deploy the complete platform with a single Helm release:

```bash
helm upgrade --install ai-gateway ./deployments/helm/ai-gateway-platform \
  --namespace ai-platform \
  --create-namespace \
  --values my-values.yaml \
  --wait \
  --timeout 10m
```

### Production Values Configuration (`my-values.yaml`)

```yaml
global:
  environment: production

# Gateway Workload Configuration
gateway:
  replicaCount: 3
  image:
    repository: ghcr.io/organization/ai-gateway
    tag: v1.0.0
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 2000m
      memory: 2Gi
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
    targetCPUUtilizationPercentage: 75
  podDisruptionBudget:
    enabled: true
    minAvailable: 2
  resilience:
    defaultUpstreamTimeoutMs: 15000
    defaultConcurrencyLimit: 250

# Control Plane & Embedded Console Workload
controlPlane:
  replicaCount: 2
  image:
    repository: ghcr.io/organization/ai-control-plane
    tag: v1.0.0
  resources:
    requests:
      cpu: 250m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi
  podDisruptionBudget:
    enabled: true
    minAvailable: 1

# Database Configuration (External Managed PostgreSQL like AWS RDS / GCP Cloud SQL)
database:
  internal:
    enabled: false # Disable bundled containerized postgres
  external:
    enabled: true
    host: "postgres-ha.prod.internal"
    port: 5432
    name: "gateway_prod"
    user: "gateway_app"
    sslmode: "require"
    existingSecret: "production-postgres-credentials"
    existingSecretKey: "password"
    pool:
      maxConns: 100
      minConns: 10
      maxConnIdleTime: 15m
      maxConnLifetime: 1h

# Security Keys
security:
  jwtIssuer: "https://gateway.company.com"
  jwtAudience: "gateway-api"
  allowLocalEgress: false # STRICT SSRF PREVENTION
  existingSecret: "gateway-security-secrets" # Must contain encryption-key and signing-key-encryption-key
  egressAllowedCIDRs:
    - "10.0.0.0/8"
    - "172.16.0.0/12"
    - "192.168.0.0/16"

# Ingress & TLS
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
  hosts:
    - host: gateway.company.com
      paths:
        - path: /
          pathType: Prefix
          service: gateway
    - host: console.company.com
      paths:
        - path: /
          pathType: Prefix
          service: control-plane
  tls:
    - secretName: ai-gateway-tls
      hosts:
        - gateway.company.com
        - console.company.com
```

---

## 5. Zero-Downtime Rolling Upgrades & Rollbacks

### Rolling Upgrade Execution
When upgrading image versions or configuration values:

```bash
helm upgrade ai-gateway ./deployments/helm/ai-gateway-platform \
  --namespace ai-platform \
  --set gateway.image.tag="v1.1.0" \
  --set controlPlane.image.tag="v1.1.0" \
  --reuse-values \
  --wait
```

### Upgrade Mechanics
1. **Migration Hook**: Helm triggers the pre-upgrade migration Job (`migration-job.yaml`) to run database migrations forward.
2. **Readiness Probe Coordination**: New replica pods start and must pass `/startupz` and `/readyz` before receiving production traffic.
3. **Graceful Draining**: Old pods receive `SIGTERM`. The readiness probe immediately returns `503 Service Unavailable`, dropping the pod from Kubernetes Service endpoints. Active HTTP/SSE connections are drained within `terminationGracePeriodSeconds: 30`.

### Single-Command Rollback
If any unexpected defect or performance degradation is observed post-upgrade:

```bash
# Check revision history
helm history ai-gateway -n ai-platform

# Rollback to the previous stable release (e.g., revision 1)
helm rollback ai-gateway 1 -n ai-platform --wait
```

---

## 6. Database Backup & Restore Runbook

### Backup Execution
Execute a transactional physical or logical backup using standard PostgreSQL tools:

```bash
# Dump compressed PostgreSQL schema and table data
pg_dump \
  --host=postgres-ha.prod.internal \
  --username=gateway_app \
  --dbname=gateway_prod \
  --format=custom \
  --file=gateway_backup_$(date +%Y%m%d_%H%M%S).dump
```

### Restore Procedure
1. Halt gateway writes by scaling gateway deployment to 0:
   ```bash
   kubectl scale deployment ai-gateway-ai-gateway-platform-gateway --replicas=0 -n ai-platform
   ```
2. Restore database from dump:
   ```bash
   pg_restore \
     --host=postgres-ha.prod.internal \
     --username=gateway_app \
     --dbname=gateway_prod \
     --clean \
     --if-exists \
     gateway_backup_20261020_120000.dump
   ```
3. Run migration verification:
   ```bash
   ./bin/migrate -direction=up
   ```
4. Restore gateway replicas:
   ```bash
   kubectl scale deployment ai-gateway-ai-gateway-platform-gateway --replicas=3 -n ai-platform
   ```

---

## 7. Troubleshooting & Operational Runbook

| Symptom | Probable Cause | Action |
| :--- | :--- | :--- |
| **Pods stuck in `CrashLoopBackOff`** | Database connection failure or unapplied migrations | Inspect pod logs: `kubectl logs -l app.kubernetes.io/component=gateway -n ai-platform`. Verify `database.url` and that database host is reachable. |
| **`/readyz` returns `503 Service Unavailable`** | Downstream database pool exhausted or ping timeout | Check PostgreSQL connection pool metrics (`max_conns`). Verify DB resource limits and active queries. |
| **`403 Forbidden: outbound connection to private IP disallowed`** | Outbound SSRF protection blocking unwhitelisted upstream MCP server | Add the target internal CIDR to `security.egressAllowedCIDRs` in `values.yaml`. Do **not** enable `allow_local_egress` in production. |
| **JWT verification fails across replicas** | Replicas are not sharing the same `signing_key_encryption_key` | Verify all replicas mount the exact same 32-byte AES key from Kubernetes Secret. |
| **Migration Job fails on install** | Insufficient database user privileges or locked tables | Check `kubectl logs job/ai-gateway-ai-gateway-platform-migration -n ai-platform`. Verify user has `CREATE TABLE`, `ALTER TABLE`, and `INDEX` permissions. |
| **Telemetry buffer load-shedding** | ClickHouse / OTLP endpoint slow or unreachable | Check ClickHouse connectivity and disk usage. The gateway will drop telemetry before blocking request routing, preserving gateway uptime. |

---

## 8. High-Availability & Disaster Recovery Summary

1. **Gateway Statelessness**: AI Gateway replicas hold no long-lived state in process memory. Signing keys, OAuth tokens, tenant policies, and A2A tasks reside in PostgreSQL.
2. **Multi-Zone Topology**: Replicas use `topologySpreadConstraints` to distribute pods evenly across distinct availability zones.
3. **Disruption Protection**: `PodDisruptionBudget` prevents voluntary cluster maintenance from dropping active replicas below minimum quorum.
4. **Resilience Policies**: Circuit breakers, bulkheads, and token bucket rate limits prevent cascading failure when upstream MCP servers or A2A agents become unresponsive.
