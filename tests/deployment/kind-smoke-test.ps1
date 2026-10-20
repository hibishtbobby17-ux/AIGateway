# ==============================================================================
# Local Kubernetes (kind) Automated Smoke Test Harness (PowerShell)
# Exercises single-chart deployment, readiness probes, rolling upgrade,
# and rollback on a disposable local kind cluster.
# ==============================================================================
param (
    [string]$ClusterName = "ai-gateway-smoke",
    [string]$ReleaseName = "ai-gateway",
    [string]$ChartDir = "./deployments/helm/ai-gateway-platform",
    [string]$Namespace = "default",
    [switch]$KeepCluster
)

$ErrorActionPreference = "Stop"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " Starting AI Gateway Kubernetes Single-Chart Smoke Test" -ForegroundColor Cyan
Write-Host " Cluster:   $ClusterName" -ForegroundColor Cyan
Write-Host " Release:   $ReleaseName" -ForegroundColor Cyan
Write-Host " Chart:     $ChartDir" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Prerequisite checks
foreach ($cmd in @("docker", "kubectl", "helm", "kind")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "[-] '$cmd' is required but not installed in PATH."
    }
}

# 2. Setup disposable kind cluster
$existing = kind get clusters 2>$null
if ($existing -contains $ClusterName) {
    Write-Host "[+] Reusing existing kind cluster: $ClusterName" -ForegroundColor Yellow
} else {
    Write-Host "[+] Creating disposable kind cluster: $ClusterName..." -ForegroundColor Green
    kind create cluster --name $ClusterName
}

kubectl cluster-info --context "kind-$ClusterName"

# 3. Build local docker images
Write-Host "[+] Building local container images for smoke testing..." -ForegroundColor Green
docker build -t ghcr.io/organization/ai-gateway:v1.0.0 -f deployments/docker/Dockerfile.gateway .
docker build -t ghcr.io/organization/ai-control-plane:v1.0.0 -f deployments/docker/Dockerfile.control-plane .
docker build -t ghcr.io/organization/ai-gateway-migrate:v1.0.0 -f deployments/docker/Dockerfile.migrate .

# 4. Load images into kind node
Write-Host "[+] Loading images into kind cluster node..." -ForegroundColor Green
kind load docker-image ghcr.io/organization/ai-gateway:v1.0.0 --name $ClusterName
kind load docker-image ghcr.io/organization/ai-control-plane:v1.0.0 --name $ClusterName
kind load docker-image ghcr.io/organization/ai-gateway-migrate:v1.0.0 --name $ClusterName

# 5. Lint Helm chart
Write-Host "[+] Linting umbrella Helm chart..." -ForegroundColor Green
helm lint $ChartDir

# 6. Install single Helm release
Write-Host "[+] Installing umbrella chart with internal Postgres enabled..." -ForegroundColor Green
helm upgrade --install $ReleaseName $ChartDir `
    --namespace $Namespace `
    --set gateway.image.pullPolicy=Never `
    --set controlPlane.image.pullPolicy=Never `
    --set migration.image.pullPolicy=Never `
    --wait `
    --timeout 5m

Write-Host "[+] Helm release status:" -ForegroundColor Green
helm status $ReleaseName -n $Namespace

# 7. Verify Deployment rollouts
Write-Host "[+] Verifying workload rollout statuses..." -ForegroundColor Green
kubectl rollout status "deployment/$ReleaseName-ai-gateway-platform-gateway" -n $Namespace --timeout=120s
kubectl rollout status "deployment/$ReleaseName-ai-gateway-platform-control-plane" -n $Namespace --timeout=120s

# 8. Probe checks inside cluster
Write-Host "[+] Testing service endpoints from inside the cluster..." -ForegroundColor Green
kubectl run smoke-curl --image=curlimages/curl:8.6.0 --restart=Never --rm -i -- `
    curl -s -f "http://$ReleaseName-ai-gateway-platform-gateway:8080/healthz"
Write-Host " -> Gateway /healthz passed" -ForegroundColor Green

kubectl run smoke-curl-ready --image=curlimages/curl:8.6.0 --restart=Never --rm -i -- `
    curl -s -f "http://$ReleaseName-ai-gateway-platform-gateway:8080/readyz"
Write-Host " -> Gateway /readyz passed" -ForegroundColor Green

kubectl run smoke-curl-cp --image=curlimages/curl:8.6.0 --restart=Never --rm -i -- `
    curl -s -f "http://$ReleaseName-ai-gateway-platform-control-plane:8081/healthz"
Write-Host " -> Control Plane /healthz passed" -ForegroundColor Green

# 9. Test Rolling Upgrade
Write-Host "[+] Testing rolling upgrade (increasing gateway replicas)..." -ForegroundColor Green
helm upgrade $ReleaseName $ChartDir `
    --namespace $Namespace `
    --set gateway.replicaCount=3 `
    --set gateway.image.pullPolicy=Never `
    --set controlPlane.image.pullPolicy=Never `
    --wait `
    --timeout 3m
kubectl rollout status "deployment/$ReleaseName-ai-gateway-platform-gateway" -n $Namespace
Write-Host " -> Rolling upgrade completed cleanly" -ForegroundColor Green

# 10. Test Single-Release Rollback
Write-Host "[+] Testing single-release rollback..." -ForegroundColor Green
helm rollback $ReleaseName 1 --wait --timeout 3m
kubectl rollout status "deployment/$ReleaseName-ai-gateway-platform-gateway" -n $Namespace
Write-Host " -> Rollback to revision 1 completed cleanly" -ForegroundColor Green

# 11. Cleanup
if (-not $KeepCluster) {
    Write-Host "[+] Cleaning up kind cluster: $ClusterName..." -ForegroundColor Green
    kind delete cluster --name $ClusterName
    Write-Host "[+] Smoke test completed successfully and cluster destroyed." -ForegroundColor Green
} else {
    Write-Host "[*] Cluster $ClusterName kept alive for inspection." -ForegroundColor Yellow
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " KUBERNETES DEPLOYMENT SMOKE TEST PASSED" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
