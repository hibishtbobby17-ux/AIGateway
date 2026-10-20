# Operational Runbooks & Reliability Procedures

This runbook documents operational procedures, incident response workflows, backup/restore mechanisms, and retention policies for the AI Gateway and Control Plane (Milestone 7).

---

## 1. Incident Response Runbooks

### 1.1 Alert: Upstream Circuit Breaker Tripped (`StateOpen`)
- **Severity**: HIGH (P2)
- **Symptom**: Inbound requests to a specific MCP tool or A2A agent fail fast with `ErrCircuitBreakerOpen` (HTTP 503).
- **Metric**: `ai_gateway_circuit_breaker_state{state="OPEN"}`
- **Cause**: Upstream service encountered 5+ consecutive failures, connection timeouts, or >50% failure rate.
- **Remediation Steps**:
  1. Inspect observed topology in the Management Console (`http://<control-plane>:8081/console/`) under **Observed Topology**.
  2. Locate the red/unhealthy node and view sample trace IDs.
  3. Query correlated error logs in the Console via **Log Search** for the affected `mcp_server_id` or `agent_id`.
  4. Perform an active probe via the Console's **Probe Connection** button or management API:
     ```bash
     curl -X POST -H "Authorization: Bearer $TOKEN" -H "X-Tenant-ID: $TENANT_ID" \
       http://<control-plane>:8081/api/v1/mcp-servers/$SERVER_ID/health
     ```
  5. If the upstream provider is undergoing an outage, the breaker automatically isolates the failure, protecting gateway worker threads.
  6. Once upstream recovers, the circuit breaker automatically transitions to `HALF-OPEN`, sends a probe request, and transitions to `CLOSED` upon success.

---

### 1.2 Alert: Bulkhead Concurrency Limit Reached
- **Severity**: MEDIUM (P3)
- **Symptom**: Incoming requests to a specific upstream receive HTTP 503 with error message `upstream bulkhead concurrency limit reached`.
- **Metric**: `ai_gateway_bulkhead_inflight == limit`
- **Cause**: Upstream service latency increased or call volume exceeded the configured `concurrency_limit` (default: 50).
- **Remediation Steps**:
  1. Verify if the upstream server is simply experiencing high legitimate load or slow response times.
  2. If upstream can support higher concurrency, update the server/agent registration in the Console or via API:
     ```bash
     curl -X PUT -H "Authorization: Bearer $TOKEN" -H "X-Tenant-ID: $TENANT_ID" \
       -H "Content-Type: application/json" \
       -d '{"concurrency_limit": 100}' \
       http://<control-plane>:8081/api/v1/mcp-servers/$SERVER_ID
     ```
  3. Notice that other upstreams remain completely unaffected due to bulkhead isolation.

---

### 1.3 Alert: Rate Limit Exceeded (`HTTP 429`)
- **Severity**: LOW (P4) / Informational
- **Symptom**: Tenant or client receives HTTP 429 Too Many Requests with `Retry-After` header.
- **Remediation Steps**:
  1. Verify caller rate: check `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers.
  2. If the tenant requires an upgraded tier (e.g., enterprise upgrade from 600 req/min to 6000 req/min), update the tenant's tier in the control plane:
     ```bash
     curl -X PUT -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"tier": "enterprise"}' \
       http://<control-plane>:8081/api/v1/tenants/$TENANT_ID
     ```

---

### 1.4 Alert: Telemetry Ring Buffer Overload (Load Shedding)
- **Severity**: MEDIUM (P3)
- **Symptom**: Inbound spans are dropped via non-blocking load shedding.
- **Metric**: `ai_gateway_telemetry_dropped_total`
- **Cause**: Persistent database or telemetry storage outage.
- **Safety Invariant**: Under ADR-0005, gateway traffic is **never blocked** by telemetry outages. Inbound MCP and A2A calls proceed without interruption.
- **Remediation Steps**:
  1. Verify database / storage pool health:
     ```bash
     curl http://<gateway>:8080/readyz
     ```
  2. Check storage connection pool metrics and database CPU/disk utilization.
  3. Once the database recovers, the background batch worker resumes flushing without manual intervention.

---

## 2. Backup & Disaster Recovery Procedures

### 2.1 PostgreSQL Production Backup
Run daily full backups and continuous WAL archiving:
```bash
# 1. Full database dump
pg_dump -h $PG_HOST -U $PG_USER -d $PG_DATABASE -Fc -f /backups/gateway_$(date +%Y%m%d_%H%M%S).dump

# 2. Verify backup integrity
pg_restore -l /backups/gateway_$(date +%Y%m%d_%H%M%S).dump > /dev/null
```

### 2.2 PostgreSQL Restore Procedure
```bash
# 1. Stop gateway and control-plane instances
kubectl scale deployment/ai-gateway --replicas=0
kubectl scale deployment/ai-control-plane --replicas=0

# 2. Restore database schema and data
pg_restore -h $PG_HOST -U $PG_USER -d $PG_DATABASE --clean --if-exists /backups/gateway_backup.dump

# 3. Apply any newer pending migrations
go run ./cmd/migrate -direction up

# 4. Scale services back up
kubectl scale deployment/ai-gateway --replicas=3
kubectl scale deployment/ai-control-plane --replicas=2
```

### 2.3 SQLite Development / Edge Backup
```bash
# Safe live online SQLite backup using sqlite3 CLI
sqlite3 gateway.db ".backup 'gateway_backup_$(date +%Y%m%d).db'"
```

---

## 3. Data Retention & Cleanup Policies

| Data Category | Table / Store | Retention Period | Purge Mechanism |
| :--- | :--- | :--- | :--- |
| **Distributed Traces** | `telemetry_spans` | 14 days | Automated daily cron: `DELETE FROM telemetry_spans WHERE start_time < NOW() - INTERVAL '14 days'` |
| **Application Logs** | `telemetry_logs` | 30 days | Daily cron: `DELETE FROM telemetry_logs WHERE timestamp < NOW() - INTERVAL '30 days'` |
| **A2A Task Events** | `a2a_task_events` | 90 days | Pruning of terminal tasks (`COMPLETED`, `FAILED`, `CANCELLED`) |
| **Security Audit Logs**| `audit_logs` | 365 days (1 year) | Immutable, compliance-enforced archive |
| **Token Revocations** | `token_revocations` | TTL = token expiration | Automatic cleanup of revocations whose tokens have naturally expired |
| **Signing Keys** | `signing_keys` | 90 days active, 180 days verification | Automated key rotation policy per ADR-0004 |
