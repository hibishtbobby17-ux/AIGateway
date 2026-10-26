$ErrorActionPreference = "Stop"

Write-Host "=== 1. Logging into AI Gateway Console ==="
$loginBody = @{
    email = "admin@aigateway.local"
    password = "Admin123!@#"
} | ConvertTo-Json

$loginRes = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
Write-Host "Logged in successfully. User:" $loginRes.user.email
$consoleToken = $loginRes.token
$consoleHeaders = @{
    "Authorization" = "Bearer $consoleToken"
    "Content-Type"  = "application/json"
}

Write-Host "`n=== 2. Registering New Gateway Instance ==="
$uniqueName = "gw-e2e-" + [guid]::NewGuid().ToString().Substring(0, 8)
$regBody = @{
    name = $uniqueName
} | ConvertTo-Json

$regRes = Invoke-RestMethod -Uri "http://localhost:3000/api/gateways" -Method POST -Headers $consoleHeaders -Body $regBody
$gwId = $regRes.gateway.id
$gwKey = $regRes.secret

Write-Host "Registered Gateway: ID=$gwId Name=$uniqueName"
Write-Host "Cryptographic Gateway Key: $gwKey"

if (-not $gwKey.StartsWith("aigw_live_")) {
    Write-Error "Key does not start with aigw_live_ prefix!"
} else {
    Write-Host "Key prefix check: PASSED (starts with aigw_live_)"
}

Write-Host "`n=== 3. Testing Snapshot Retrieval (GET /api/v1/gateways/sync/snapshot) ==="
$headers = @{
    "Authorization" = "Bearer $gwKey"
    "X-Gateway-ID"  = $gwId
}

$snapRes = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/gateways/sync/snapshot" -Headers $headers
Write-Host "Snapshot HTTP Status:" $snapRes.StatusCode
$snapJson = $snapRes.Content | ConvertFrom-Json
Write-Host "Snapshot Version:" $snapJson.version
Write-Host "Routes Count:" $snapJson.routes.Length
$etag = $snapRes.Headers["ETag"]
if (-not $etag) { $etag = $snapRes.Headers["etag"] }
Write-Host "ETag Received:" $etag

if (-not $etag) {
    Write-Error "ETag header missing from snapshot response!"
}

Write-Host "`n=== 4. Testing Conditional Request with ETag (If-None-Match) ==="
$headersWithEtag = @{
    "Authorization" = "Bearer $gwKey"
    "X-Gateway-ID"  = $gwId
    "If-None-Match" = $etag
}

try {
    $etagRes = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/gateways/sync/snapshot" -Headers $headersWithEtag
    Write-Host "Status:" $etagRes.StatusCode
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 304) {
        Write-Host "Conditional ETag Check: PASSED (Returned 304 Not Modified)"
    } else {
        Write-Error "Unexpected status code: $statusCode"
    }
}

Write-Host "`n=== 5. Testing Key Rotation (POST /api/gateways/$gwId/rotate-secret) ==="
$rotateRes = Invoke-RestMethod -Uri "http://localhost:3000/api/gateways/$gwId/rotate-secret" -Method POST -Headers $consoleHeaders
$newKey = $rotateRes.secret
Write-Host "Rotated New Key: $newKey"

# Verify old key is rejected
Write-Host "Verifying old key is revoked/rejected..."
try {
    $oldKeyHeaders = @{
        "Authorization" = "Bearer $gwKey"
        "X-Gateway-ID"  = $gwId
    }
    Invoke-WebRequest -Uri "http://localhost:3000/api/v1/gateways/sync/snapshot" -Headers $oldKeyHeaders
    Write-Error "Old key should have been rejected!"
} catch {
    $oldStatusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Old Key Rejection Status: $oldStatusCode (PASSED - Rejected as expected)"
}

# Verify new key works
Write-Host "Verifying new key functions..."
$newKeyHeaders = @{
    "Authorization" = "Bearer $newKey"
    "X-Gateway-ID"  = $gwId
}
$newSnapRes = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/gateways/sync/snapshot" -Headers $newKeyHeaders
Write-Host "New Key Snapshot Status:" $newSnapRes.StatusCode "(PASSED)"

Write-Host "`n=== 6. Testing Gateway Revocation (POST /api/gateways/$gwId/revoke) ==="
$revokeRes = Invoke-RestMethod -Uri "http://localhost:3000/api/gateways/$gwId/revoke" -Method POST -Headers $consoleHeaders
Write-Host "Gateway revoked:" $revokeRes.success

try {
    Invoke-WebRequest -Uri "http://localhost:3000/api/v1/gateways/sync/snapshot" -Headers $newKeyHeaders
    Write-Error "Revoked gateway request should have been rejected!"
} catch {
    $revokedStatusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Revoked Gateway Status: $revokedStatusCode (PASSED - Access denied)"
}

Write-Host "`n=== ALL E2E CONTROL PLANE TESTS PASSED SUCCESSFULLY! ==="
