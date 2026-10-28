[CmdletBinding()]
param(
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    & docker compose -f (Join-Path $repoRoot 'compose.yaml') @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($ComposeArgs -join ' ') failed with exit code $LASTEXITCODE."
    }
}

Write-Host ''
Write-Host 'QuantaEdge | Lucky Bajaj — local stack' -ForegroundColor Cyan
Write-Host 'Customer web : http://localhost:3000' -ForegroundColor White
Write-Host 'Staff web    : http://localhost:3001' -ForegroundColor White
Write-Host 'Backend API  : http://localhost:8080' -ForegroundColor White
Write-Host 'API health   : http://localhost:8080/actuator/health' -ForegroundColor White
Write-Host ''

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI was not found. Install/start Docker Desktop, then run this script again.'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Engine is not running. Start Docker Desktop and wait until it is ready.'
}
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose v2 is required (docker compose).'
}

# Follow mPAY's physical-device convention but discover the current host LAN IP.
$lanIp = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -notmatch '^(127\.|169\.254\.)' } |
    Select-Object -First 1
if (-not $lanIp) { $lanIp = '192.168.31.47' }

$androidBaseUrl = $env:BAJAJ_ANDROID_API_BASE_URL
if ([string]::IsNullOrWhiteSpace($androidBaseUrl)) {
    $androidBaseUrl = "http://${lanIp}:8080/"
}
$androidEnv = Join-Path $repoRoot 'apps/android/.env'
if (-not (Test-Path $androidEnv) -or -not [string]::IsNullOrWhiteSpace($env:BAJAJ_ANDROID_API_BASE_URL)) {
    "EXPO_PUBLIC_API_BASE_URL=$androidBaseUrl" | Set-Content -Path $androidEnv -Encoding ascii
} else {
    $configured = Get-Content $androidEnv | Where-Object { $_ -match '^\s*EXPO_PUBLIC_API_BASE_URL\s*=' } | Select-Object -First 1
    if ($configured) { $androidBaseUrl = ($configured -split '=', 2)[1].Trim().Trim('"').Trim("'") }
}

Write-Host "Android API  : $androidBaseUrl" -ForegroundColor DarkGray
Write-Host 'Building and starting PostgreSQL, Spring Boot API, customer web and staff web…' -ForegroundColor Cyan
Invoke-Compose -ComposeArgs @('config', '--quiet')
if ($Rebuild) {
    Invoke-Compose -ComposeArgs @('build', '--no-cache')
}
Invoke-Compose -ComposeArgs @('up', '--build', '-d')

$checks = @(
    @{ Name = 'Backend API'; Uri = 'http://localhost:8080/actuator/health' },
    @{ Name = 'Customer web'; Uri = 'http://localhost:3000/' },
    @{ Name = 'Staff web'; Uri = 'http://localhost:3001/' }
)
$pending = @()
$ready = $false
for ($attempt = 1; $attempt -le 90; $attempt++) {
    $pending = @()
    foreach ($check in $checks) {
        try {
            $response = Invoke-WebRequest -Uri $check.Uri -TimeoutSec 3 -UseBasicParsing
            if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
                $pending += $check
            }
        } catch {
            $pending += $check
        }
    }
    if ($pending.Count -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    Write-Host ''
    Write-Host 'The stack did not become fully healthy. Recent logs follow:' -ForegroundColor Red
    & docker compose -f (Join-Path $repoRoot 'compose.yaml') logs --tail=100
    throw "Timed out waiting for: $($pending.Name -join ', ')."
}

Write-Host ''
Write-Host 'All local services responded successfully.' -ForegroundColor Green
Write-Host 'Customer website : http://localhost:3000' -ForegroundColor Green
Write-Host 'Staff portal     : http://localhost:3001' -ForegroundColor Green
Write-Host 'Backend API      : http://localhost:8080' -ForegroundColor Green
Write-Host "Android device   : $androidBaseUrl" -ForegroundColor Green
Write-Host ''
Invoke-Compose -ComposeArgs @('ps')
