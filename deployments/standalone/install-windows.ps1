# AI Gateway Windows Standalone Host Installer
# Specification from Section 7 of ai_gateway_architecture_and_deployment_plan.md

param (
    [Parameter(Mandatory=$true, HelpMessage="Cryptographically generated AI Gateway Key (aigw_live_...)")]
    [string]$GatewayKey,

    [Parameter(Mandatory=$false)]
    [string]$ConsoleUrl = "https://console.company.internal/api/v1",

    [Parameter(Mandatory=$false)]
    [string]$InstallDir = "C:\Program Files\AiGateway",

    [Parameter(Mandatory=$false)]
    [string]$DataDir = "C:\ProgramData\AiGateway",

    [Parameter(Mandatory=$false)]
    [int]$ListenPort = 8080
)

$ErrorActionPreference = "Stop"

Write-Host "==> Creating installation and data directories..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$CachePath = Join-Path $DataDir "cache.db"
$ConfigFile = Join-Path $DataDir "config.json"

Write-Host "==> Securely saving configuration to $ConfigFile..." -ForegroundColor Cyan
@{
    AI_GATEWAY_KEY = $GatewayKey
    CONSOLE_URL    = $ConsoleUrl
    CACHE_PATH     = $CachePath
    LISTEN_PORT    = $ListenPort
    LOG_LEVEL      = "info"
} | ConvertTo-Json -Depth 4 | Set-Content -Path $ConfigFile -Encoding UTF8

# Set restricted NTFS ACLs on ConfigFile (Administrators and SYSTEM only)
try {
    $Acl = Get-Acl $ConfigFile
    $Acl.SetAccessRuleProtection($true, $false)
    $AdminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators", "FullControl", "Allow")
    $SystemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")
    $Acl.AddAccessRule($AdminRule)
    $Acl.AddAccessRule($SystemRule)
    Set-Acl -Path $ConfigFile -AclObject $Acl
} catch {
    Write-Warning "Could not restrict ACL permissions on config.json: $_"
}

$ExePath = Join-Path $InstallDir "ai-gateway.exe"

# If local binary exists in script directory, copy it to InstallDir
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$LocalBin = Join-Path $ScriptDir "..\..\bin\ai-gateway-windows-amd64.exe"
if (Test-Path $LocalBin) {
    Copy-Item -Path $LocalBin -Destination $ExePath -Force
    Write-Host "==> Copied binary to $ExePath" -ForegroundColor Green
}

Write-Host "==> Registering Windows Service 'AiGateway'..." -ForegroundColor Cyan
$BinArgs = "`"$ExePath`" --config `"$ConfigFile`""

# Check if service already exists
$ExistingService = Get-Service -Name "AiGateway" -ErrorAction SilentlyContinue
if ($ExistingService) {
    Write-Host "==> Stopping existing AiGateway service..."
    Stop-Service -Name "AiGateway" -Force -ErrorAction SilentlyContinue
    sc.exe config AiGateway binPath= $BinArgs start= auto | Out-Null
} else {
    sc.exe create AiGateway binPath= $BinArgs start= auto DisplayName= "AI Gateway Service" | Out-Null
    sc.exe failure AiGateway reset= 86400 actions= restart/5000/restart/10000/restart/60000 | Out-Null
}

try {
    Start-Service -Name "AiGateway" -ErrorAction SilentlyContinue
    Write-Host "==> AI Gateway service registered and started successfully on port $ListenPort." -ForegroundColor Green
} catch {
    Write-Host "==> Service created. Ensure $ExePath is in place before starting service." -ForegroundColor Yellow
}
