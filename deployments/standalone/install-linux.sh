#!/usr/bin/env bash
set -euo pipefail

# AI Gateway Linux Standalone Host Installer
# Specification from Section 7 of ai_gateway_architecture_and_deployment_plan.md

AI_GATEWAY_KEY="${AI_GATEWAY_KEY:-}"
CONSOLE_URL="${CONSOLE_URL:-https://console.company.internal/api/v1}"
LISTEN_PORT="${LISTEN_PORT:-8080}"
BIN_SOURCE="${BIN_SOURCE:-/usr/local/bin/ai-gateway}"

if [ -z "$AI_GATEWAY_KEY" ]; then
  echo "Error: AI_GATEWAY_KEY environment variable is required." >&2
  echo "Usage: AI_GATEWAY_KEY=aigw_live_... CONSOLE_URL=https://... $0" >&2
  exit 1
fi

echo "==> Setting up system user and directories..."
id -u aigateway &>/dev/null || useradd -r -s /bin/false aigateway
mkdir -p /var/lib/ai-gateway /etc/ai-gateway
chown -R aigateway:aigateway /var/lib/ai-gateway /etc/ai-gateway

echo "==> Writing secure configuration to /etc/ai-gateway/config.env..."
cat <<EOF > /etc/ai-gateway/config.env
AI_GATEWAY_KEY=${AI_GATEWAY_KEY}
CONSOLE_URL=${CONSOLE_URL}
CACHE_PATH=/var/lib/ai-gateway/cache.db
LISTEN_PORT=${LISTEN_PORT}
LOG_LEVEL=info
EOF
chmod 600 /etc/ai-gateway/config.env
chown aigateway:aigateway /etc/ai-gateway/config.env

echo "==> Creating systemd service unit /etc/systemd/system/ai-gateway.service..."
cat <<EOF > /etc/systemd/system/ai-gateway.service
[Unit]
Description=AI Gateway Proxy Daemon
Documentation=https://github.com/my-org/ai-gateway
After=network.target

[Service]
Type=simple
User=aigateway
Group=aigateway
EnvironmentFile=/etc/ai-gateway/config.env
ExecStart=${BIN_SOURCE}
Restart=always
RestartSec=5
LimitNOFILE=65536
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

if command -v systemctl &>/dev/null; then
  echo "==> Reloading systemd and enabling ai-gateway service..."
  systemctl daemon-reload
  systemctl enable --now ai-gateway
  echo "==> AI Gateway service started successfully."
else
  echo "Warning: systemctl not found (container environment). Service file created at /etc/systemd/system/ai-gateway.service"
fi
