# AI Gateway: Cross-Platform Architecture, Sync Protocol & Deployment Specification

## 1. Executive Summary

The AI Gateway is a lightweight, high-performance reverse proxy designed to govern, observe, route, and secure LLM inference traffic across multiple providers (e.g., OpenAI, Anthropic, Bedrock, self-hosted models).

This specification details the architecture required to:
- Deploy the AI Gateway independently on Kubernetes via a unified Helm chart.
- Support native host and container execution across both **Linux** and **Windows** operating systems.
- Authenticate and synchronize runtime configurations, policies, and secrets from an Admin Management Console using a cryptographically generated gateway key.
- Provide zero-downtime resilience against network partitions via local offline caching.

---

## 2. Architecture Overview & Authentication Flow

The gateway operates on a decoupled Control Plane / Data Plane separation model:

```
┌────────────────────────────────────────────────────────┐
│               Admin Management Console                 │
│                 (Control Plane)                        │
└────────────┬──────────────────────────────▲────────────┘
             │                              │
 1. Issue Key│                              │ 3. Sync Policies & Routes
   & Secret  │                              │    (REST Snapshot + SSE Stream)
             ▼                              │
┌──────────────────────────────┐            │
│ Deployment Target            │            │
│ (K8s / Linux / Windows Node) │            │
│                              │            │
│   ┌────────────────────────┐ │            │
│   │ AI Gateway Instance    │─┴────────────┘
│   │ (In-memory + Cache DB) │
│   └───────────┬────────────┘
│               │
└───────────────┼────────────────────────────────────────
                │ 4. Route LLM Prompts & Enforce Guards
                ▼
       ┌─────────────────┐
       │ LLM Providers   │ (OpenAI, Claude, Local vLLM)
       └─────────────────┘
```

### Key Generation and Lifecycle
1. **Console Creation:**
   - On gateway creation, the Console generates a cryptographically random token: `aigw_live_<32_random_bytes_hex>`.
   - The Console computes and stores an **Argon2id** or **SHA-256 + Server Salt** hash of the key. The plaintext token is never stored in the database.
   - The plaintext key is surfaced **once** in the UI with copyable scripts for Helm, Docker, Linux systemd, and Windows PowerShell.
2. **Gateway Ingestion:**
   - Ingested via environment variable (`AI_GATEWAY_KEY`) or mounted secret file (`/etc/ai-gateway/token`).
3. **Mutual Handshake:**
   - Every request from the Gateway to the Console includes:
     ```http
     Authorization: Bearer aigw_live_a1b2c3d4e5...
     X-Gateway-ID: gw_prod_east_01
     ```

---

## 3. Protocol Research & Selected Sync Architecture

### Protocol Benchmark Evaluation

| Dimension | gRPC Bidirectional Stream (HTTP/2) | Server-Sent Events (SSE) + REST Snapshot | WebSockets | Periodic Polling (ETag) |
| :--- | :--- | :--- | :--- | :--- |
| **Corporate Firewall Traversal** | Moderate (strict proxies may drop HTTP/2 or ALPN) | **Optimal** (standard HTTP/1.1 or HTTP/2 GET over port 443) | Moderate (often blocked or downgraded by enterprise WAFs) | **Optimal** (plain HTTP requests) |
| **Payload Delivery Latency** | Near-zero push | Near-zero push | Near-zero push | Pull-bound (e.g., 15s–60s delay) |
| **Reconnection & Recovery** | Built-in stream recovery, higher implementation effort | Native `Last-Event-ID` resume semantics | Manual ping/pong & reconnection state | Built-in stateless retries |
| **Transport Overhead** | Low (Protobuf binary) | Low (Plain text / JSON stream over TLS) | Low after handshake | High redundant bandwidth if polling frequently |
| **Complexity & Client Size** | High (Protobuf compilation, complex client) | **Low** (Simple HTTP client, zero external heavy dependencies) | Medium | Very Low |

### Recommendation: Hybrid REST Snapshot + SSE Stream

A **Hybrid Model** balances instant push delivery with enterprise firewall compatibility and resilience:

1. **Bootstrap Phase (REST Snapshot):**
   - Gateway calls `GET /api/v1/gateways/sync/snapshot`.
   - Headers: `Authorization: Bearer <KEY>`, `If-None-Match: <LOCAL_CACHE_ETAG>`.
   - Response: Complete snapshot payload with monotonic configuration version (e.g., `ETag: "v140"`).
   - Gateway saves state to in-memory active tables and writes an encrypted copy to the local disk cache.

2. **Continuous Push Phase (Server-Sent Events):**
   - Gateway subscribes to `GET /api/v1/gateways/sync/stream`.
   - Headers: `Authorization: Bearer <KEY>`, `Last-Event-ID: "v140"`.
   - Event types pushed:
     - `route_upsert`: Add or update a model routing rule.
     - `route_delete`: Remove a route.
     - `guardrail_update`: Updated token limits or regex filtering rules.
     - `key_rotation`: Upstream provider API key refresh.

3. **Drift & Resynchronization Handling:**
   - If stream disconnects, gateway enters exponential backoff (initial: 1s, max: 30s with jitter).
   - If an event arrives with a version gap (e.g., received `v143` when local is `v140`), the gateway aborts the stream, re-executes the REST Snapshot fetch, and reconnects.

---

## 4. Configuration Schema Specification

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "version": "v140",
  "timestamp": "2026-10-26T15:00:00Z",
  "routes": [
    {
      "id": "route_claude_prod",
      "path_prefix": "/v1/chat/completions/claude",
      "upstream": "https://api.anthropic.com",
      "model_mapping": {
        "incoming": "claude-3-5-sonnet",
        "target": "claude-3-5-sonnet-20241022"
      },
      "timeout_ms": 30000,
      "retries": 2,
      "circuit_breaker": {
        "failure_threshold_pct": 50,
        "recovery_time_sec": 15
      }
    }
  ],
  "providers": [
    {
      "id": "anthropic_main",
      "provider": "anthropic",
      "credential": {
        "type": "bearer",
        "token_ref": "secret_enc_a9f823bc..."
      },
      "rate_limits": {
        "rpm": 5000,
        "tpm": 200000
      }
    }
  ],
  "guardrails": {
    "blocked_regex_patterns": [
      "(?i)(api[_-]?key|bearer\\s+[a-z0-9_-]+)",
      "(?i)(password|secret)\\s*[:=]\\s*['\"][^'\"]+['\"]"
    ],
    "max_input_tokens": 16384,
    "pii_redaction": true
  }
}
```

---

## 5. Offline Resiliency and Local Storage

To eliminate central server dependency for high availability:
- **Encrypted Local Cache (`cache.db`):**
  - Stored at `/var/lib/ai-gateway/cache.db` (Linux/K8s) or `C:\ProgramData\AiGateway\cache.db` (Windows).
  - Uses AES-GCM-256 derived from the `AI_GATEWAY_KEY`.
- **Partition Behavior:**
  - If the Console fails or goes offline, the gateway continues routing traffic using the in-memory state.
  - If the gateway node reboots during a control plane outage, it boots from the local cache file and logs a warning: `Operating in degraded offline cached mode`.

---

## 6. Kubernetes Deployment (Helm Chart)

### Chart File Tree
```text
charts/ai-gateway/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── _helpers.tpl
    ├── deployment.yaml
    ├── service.yaml
    ├── secret.yaml
    └── pvc.yaml
```

### `values.yaml`
```yaml
replicaCount: 2

image:
  repository: ghcr.io/my-org/ai-gateway
  pullPolicy: IfNotPresent
  tag: "1.0.0"

gateway:
  consoleUrl: "https://console.company.internal/api/v1"
  listenPort: 8080
  logLevel: "info"
  cachePath: "/var/lib/ai-gateway/cache.db"

auth:
  # Option 1: Direct key injection (creates Kubernetes Secret)
  key: ""
  # Option 2: Pre-existing secret created by external vault / CI
  existingSecret:
    name: ""
    keyName: "AI_GATEWAY_KEY"

# Target OS Selection: "linux" or "windows"
nodeSelector:
  kubernetes.io/os: linux

persistence:
  enabled: true
  storageClass: ""
  size: 1Gi

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 100m
    memory: 256Mi
```

### `templates/deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "ai-gateway.fullname" . }}
  labels:
    app.kubernetes.io/name: {{ include "ai-gateway.name" . }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "ai-gateway.name" . }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ include "ai-gateway.name" . }}
    spec:
      nodeSelector:
        {{- toYaml .Values.nodeSelector | nindent 8 }}
      containers:
        - name: gateway
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.gateway.listenPort }}
              protocol: TCP
          env:
            - name: CONSOLE_URL
              value: {{ .Values.gateway.consoleUrl | quote }}
            - name: LISTEN_PORT
              value: {{ .Values.gateway.listenPort | quote }}
            - name: CACHE_PATH
              value: {{ .Values.gateway.cachePath | quote }}
            - name: AI_GATEWAY_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ ternary (include "ai-gateway.fullname" .) .Values.auth.existingSecret.name (empty .Values.auth.existingSecret.name) }}
                  key: {{ ternary "AI_GATEWAY_KEY" .Values.auth.existingSecret.keyName (empty .Values.auth.existingSecret.keyName) }}
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
          volumeMounts:
            - name: cache-vol
              mountPath: /var/lib/ai-gateway
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      volumes:
        - name: cache-vol
          {{- if .Values.persistence.enabled }}
          persistentVolumeClaim:
            claimName: {{ include "ai-gateway.fullname" . }}-cache
          {{- else }}
          emptyDir: {}
          {{- end }}
```

---

## 7. Cross-Platform Standalone Deployment (Linux & Windows)

### Linux (Systemd Service)
```bash
#!/usr/bin/env bash
set -euo pipefail

AI_GATEWAY_KEY="${AI_GATEWAY_KEY:-}"
CONSOLE_URL="${CONSOLE_URL:-https://console.company.internal/api/v1}"

if [ -z "$AI_GATEWAY_KEY" ]; then
  echo "Error: AI_GATEWAY_KEY environment variable is required." >&2
  exit 1
fi

useradd -r -s /bin/false aigateway || true
mkdir -p /var/lib/ai-gateway /etc/ai-gateway
chown -R aigateway:aigateway /var/lib/ai-gateway /etc/ai-gateway

cat <<EOF > /etc/ai-gateway/config.env
AI_GATEWAY_KEY=${AI_GATEWAY_KEY}
CONSOLE_URL=${CONSOLE_URL}
CACHE_PATH=/var/lib/ai-gateway/cache.db
LISTEN_PORT=8080
EOF
chmod 600 /etc/ai-gateway/config.env

cat <<EOF > /etc/systemd/system/ai-gateway.service
[Unit]
Description=AI Gateway Proxy Daemon
After=network.target

[Service]
Type=simple
User=aigateway
Group=aigateway
EnvironmentFile=/etc/ai-gateway/config.env
ExecStart=/usr/local/bin/ai-gateway
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ai-gateway
```

### Windows (PowerShell Host Script)
```powershell
param (
    [Parameter(Mandatory=$true)]
    [string]$GatewayKey,
    [string]$ConsoleUrl = "https://console.company.internal/api/v1",
    [string]$InstallDir = "C:\Program Files\AiGateway",
    [string]$DataDir = "C:\ProgramData\AiGateway"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Securely save config
$ConfigFile = Join-Path $DataDir "config.json"
@{
    AI_GATEWAY_KEY = $GatewayKey
    CONSOLE_URL = $ConsoleUrl
    CACHE_PATH = (Join-Path $DataDir "cache.db")
    LISTEN_PORT = 8080
} | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8

# Register as Windows Service using NSSM or native Service control
sc.exe create AiGateway binPath= "$InstallDir\ai-gateway.exe --config $ConfigFile" start= auto
sc.exe start AiGateway

Write-Host "AI Gateway service registered and started successfully."
```

---

## 8. Verification & Validation Checklist

- [ ] **Cross-Platform Compilation:** Verify multi-arch binary generation (`make build-all` creates `ai-gateway-linux-amd64`, `ai-gateway-linux-arm64`, and `ai-gateway-windows-amd64.exe`).
- [ ] **Secret Sanitization:** Verify gateway key is never emitted into console logs, monitoring traces, or client responses.
- [ ] **Helm Deployment - Linux Node:** Verify pod runs cleanly on Linux nodes and syncs configuration upon pod bootstrap.
- [ ] **Helm Deployment - Windows Node:** Switch `nodeSelector.kubernetes.io/os: windows` and verify container launch on Windows Server worker nodes.
- [ ] **Resilience Check:** Disconnect Management Console network interface. Validate that edge gateway continues processing client requests via in-memory and disk cache.
- [ ] **Revocation Check:** Revoke the gateway key from the Console. Confirm the gateway immediately terminates sync operations and enters fail-closed status.