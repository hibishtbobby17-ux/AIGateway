#!/usr/bin/env bash
# ==============================================================================
# Local Kubernetes (kind) Automated Smoke Test Harness
# Exercises single-chart deployment, readiness probes, rolling upgrade,
# and rollback on a disposable local kind cluster.
# ==============================================================================
set -euo pipefail

CLUSTER_NAME="ai-gateway-smoke"
RELEASE_NAME="ai-gateway"
CHART_DIR="./deployments/helm/ai-gateway-platform"
NAMESPACE="default"
CLEANUP="${1:-true}"

echo "=================================================================="
echo " Starting AI Gateway Kubernetes Single-Chart Smoke Test"
echo " Cluster:   ${CLUSTER_NAME}"
echo " Release:   ${RELEASE_NAME}"
echo " Chart:     ${CHART_DIR}"
echo "=================================================================="

# 1. Prerequisite checks
command -v docker >/dev/null 2>&1 || { echo "[-] docker is required but not installed."; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "[-] kubectl is required but not installed."; exit 1; }
command -v helm >/dev/null 2>&1 || { echo "[-] helm is required but not installed."; exit 1; }
command -v kind >/dev/null 2>&1 || { echo "[-] kind is required but not installed."; exit 1; }

# 2. Setup disposable kind cluster if it doesn't already exist
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "[+] Reusing existing kind cluster: ${CLUSTER_NAME}"
else
  echo "[+] Creating disposable kind cluster: ${CLUSTER_NAME}..."
  kind create cluster --name "${CLUSTER_NAME}"
fi

kubectl cluster-info --context "kind-${CLUSTER_NAME}"

# 3. Build local docker images
echo "[+] Building local container images for smoke testing..."
docker build -t ghcr.io/organization/ai-gateway:v1.0.0 -f deployments/docker/Dockerfile.gateway .
docker build -t ghcr.io/organization/ai-control-plane:v1.0.0 -f deployments/docker/Dockerfile.control-plane .
docker build -t ghcr.io/organization/ai-gateway-migrate:v1.0.0 -f deployments/docker/Dockerfile.migrate .

# 4. Load images into kind node
echo "[+] Loading images into kind cluster node..."
kind load docker-image ghcr.io/organization/ai-gateway:v1.0.0 --name "${CLUSTER_NAME}"
kind load docker-image ghcr.io/organization/ai-control-plane:v1.0.0 --name "${CLUSTER_NAME}"
kind load docker-image ghcr.io/organization/ai-gateway-migrate:v1.0.0 --name "${CLUSTER_NAME}"

# 5. Lint Helm chart
echo "[+] Linting umbrella Helm chart..."
helm lint "${CHART_DIR}"

# 6. Install single Helm release
echo "[+] Installing umbrella chart with internal Postgres enabled..."
helm upgrade --install "${RELEASE_NAME}" "${CHART_DIR}" \
  --namespace "${NAMESPACE}" \
  --set gateway.image.pullPolicy=Never \
  --set controlPlane.image.pullPolicy=Never \
  --set migration.image.pullPolicy=Never \
  --wait \
  --timeout 5m

echo "[+] Helm release status:"
helm status "${RELEASE_NAME}" -n "${NAMESPACE}"

# 7. Verify Deployment rollouts
echo "[+] Verifying workload rollout statuses..."
kubectl rollout status deployment/"${RELEASE_NAME}-ai-gateway-platform-gateway" -n "${NAMESPACE}" --timeout=120s
kubectl rollout status deployment/"${RELEASE_NAME}-ai-gateway-platform-control-plane" -n "${NAMESPACE}" --timeout=120s

# 8. Probe checks via temporary pod inside the cluster
echo "[+] Testing service endpoints from inside the cluster..."
kubectl run smoke-curl --image=curlimages/curl:8.6.0 --restart=Never --rm -i -- \
  curl -s -f "http://${RELEASE_NAME}-ai-gateway-platform-gateway:8080/healthz"
echo " -> Gateway /healthz passed"

kubectl run smoke-curl-ready --image=curlimages/curl:8.6.0 --restart=Never --rm -i -- \
  curl -s -f "http://${RELEASE_NAME}-ai-gateway-platform-gateway:8080/readyz"
echo " -> Gateway /readyz passed"

kubectl run smoke-curl-cp --image=curlimages/curl:8.6.0 --restart=Never --rm -i -- \
  curl -s -f "http://${RELEASE_NAME}-ai-gateway-platform-control-plane:8081/healthz"
echo " -> Control Plane /healthz passed"

# 9. Test Rolling Upgrade
echo "[+] Testing rolling upgrade (increasing gateway replicas)..."
helm upgrade "${RELEASE_NAME}" "${CHART_DIR}" \
  --namespace "${NAMESPACE}" \
  --set gateway.replicaCount=3 \
  --set gateway.image.pullPolicy=Never \
  --set controlPlane.image.pullPolicy=Never \
  --wait \
  --timeout 3m
kubectl rollout status deployment/"${RELEASE_NAME}-ai-gateway-platform-gateway" -n "${NAMESPACE}"
echo " -> Rolling upgrade completed cleanly"

# 10. Test Single-Release Rollback
echo "[+] Testing single-release rollback..."
helm rollback "${RELEASE_NAME}" 1 --wait --timeout 3m
kubectl rollout status deployment/"${RELEASE_NAME}-ai-gateway-platform-gateway" -n "${NAMESPACE}"
echo " -> Rollback to revision 1 completed cleanly"

# 11. Cleanup
if [ "${CLEANUP}" = "true" ]; then
  echo "[+] Cleaning up kind cluster: ${CLUSTER_NAME}..."
  kind delete cluster --name "${CLUSTER_NAME}"
  echo "[+] Smoke test completed successfully and cluster destroyed."
else
  echo "[*] Cluster ${CLUSTER_NAME} kept alive for inspection."
fi

echo "=================================================================="
echo " KUBERNETES DEPLOYMENT SMOKE TEST PASSED"
echo "=================================================================="
