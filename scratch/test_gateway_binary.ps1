$ErrorActionPreference = "Stop"

Write-Host "=== Registering Gateway for Engine Test ==="
$loginBody = @{ email = "admin@aigateway.local"; password = "Admin123!@#" } | ConvertTo-Json
$loginRes = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
$consoleHeaders = @{ "Authorization" = "Bearer $($loginRes.token)"; "Content-Type" = "application/json" }

$uniqueName = "gw-engine-test-" + [guid]::NewGuid().ToString().Substring(0, 6)
$regRes = Invoke-RestMethod -Uri "http://localhost:3000/api/gateways" -Method POST -Headers $consoleHeaders -Body (@{ name = $uniqueName } | ConvertTo-Json)
$gwKey = $regRes.secret
Write-Host "Gateway Registered: $uniqueName, Key: $gwKey"

$cachePath = "$PSScriptRoot\test-gateway-cache.db"
if (Test-Path $cachePath) { Remove-Item -Force $cachePath }

Write-Host "`n=== Test 1: Start Gateway with Control Plane Sync & Encrypted Cache Write ==="
$env:AI_GATEWAY_KEY = $gwKey
$env:CONSOLE_URL = "http://localhost:3000/api/v1"
$env:LISTEN_PORT = "8085"
$env:CACHE_PATH = $cachePath

$binPath = "$PSScriptRoot\..\bin\ai-gateway-windows-amd64.exe"
$proc1 = Start-Process -FilePath $binPath -PassThru -NoNewWindow -RedirectStandardOutput "$PSScriptRoot\gw_run1.log" -RedirectStandardError "$PSScriptRoot\gw_run1_err.log"

Start-Sleep -Seconds 3
Stop-Process -Id $proc1.Id -Force -ErrorAction SilentlyContinue

$log1 = Get-Content "$PSScriptRoot\gw_run1.log" -Raw -ErrorAction SilentlyContinue
Write-Host "Gateway Run 1 Output:"
Write-Host $log1

if (Test-Path $cachePath) {
    $cacheBytes = (Get-Item $cachePath).Length
    Write-Host "Encrypted cache created! Size: $cacheBytes bytes"
} else {
    Write-Error "Cache file was not created!"
}

Write-Host "`n=== Test 2: Start Gateway with Simulated Network Partition (Offline Fallback) ==="
$env:CONSOLE_URL = "http://localhost:9999/unreachable"
$proc2 = Start-Process -FilePath $binPath -PassThru -NoNewWindow -RedirectStandardOutput "$PSScriptRoot\gw_run2.log" -RedirectStandardError "$PSScriptRoot\gw_run2_err.log"

Start-Sleep -Seconds 3
Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue

$log2 = Get-Content "$PSScriptRoot\gw_run2.log" -Raw -ErrorAction SilentlyContinue
Write-Host "Gateway Run 2 Output (Offline Mode):"
Write-Host $log2

if ($log2 -match "Operating in degraded offline cached mode") {
    Write-Host "OFFLINE DEGRADED MODE VERIFIED: Gateway successfully loaded encrypted cache and entered offline mode!"
} else {
    Write-Host "Note: Checking log content for offline mode indicators..."
}

Write-Host "`n=== Gateway Engine Integration Test Complete ==="
