[CmdletBinding()]
param(
    [ValidateSet('Build', 'Pull')]
    [string]$Mode = 'Build',
    [ValidatePattern('^[A-Za-z0-9_][A-Za-z0-9_.-]*$')]
    [string]$Tag = 'latest',
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($Mode -eq 'Pull' -and $Rebuild) {
    throw '-Rebuild applies only to -Mode Build.'
}
$previousImageTag = $env:BAJAJ_IMAGE_TAG
$env:BAJAJ_IMAGE_TAG = $Tag

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

# Create a private ignored .env and a random one-time first-owner token.
$rootEnv = Join-Path $repoRoot '.env'
$generatedBootstrapToken = $false
$rootEnvContent = if (Test-Path $rootEnv) { Get-Content $rootEnv -Raw } else { '' }
if (-not (Test-Path $rootEnv) -or -not ($rootEnvContent -match '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=')) {
    $tokenBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
    $newToken = [BitConverter]::ToString($tokenBytes).Replace('-', '').ToLowerInvariant()
    if (-not (Test-Path $rootEnv)) {
        @"
POSTGRES_DB=bajaj_dealership
POSTGRES_USER=bajaj_app
POSTGRES_PASSWORD=bajaj_local_only
POSTGRES_PORT=5432
API_PORT=8080
CUSTOMER_WEB_PORT=3000
STAFF_WEB_PORT=3001
APP_BOOTSTRAP_TOKEN=$newToken
"@ | Set-Content -Path $rootEnv -Encoding ascii
    } elseif ($rootEnvContent -match '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=') {
        $rootEnvContent = $rootEnvContent -replace '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=.*$', "APP_BOOTSTRAP_TOKEN=$newToken"
        Set-Content -Path $rootEnv -Value $rootEnvContent -Encoding ascii
    } else {
        Add-Content -Path $rootEnv -Value "APP_BOOTSTRAP_TOKEN=$newToken" -Encoding ascii
    }
    $generatedBootstrapToken = $true
}

if ($generatedBootstrapToken) {
    $tokenContent = Get-Content $rootEnv -Raw
    $newTokenValue = [regex]::Match($tokenContent, '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=\s*(\S.*?)\s*$').Groups[1].Value.Trim().Trim('"').Trim("'")
    Write-Host ''
    Write-Host 'One-time initial owner setup token (local only):' -ForegroundColor Yellow
    Write-Host $newTokenValue -ForegroundColor Yellow
    Write-Host 'Use it in the X-Bootstrap-Token header for POST /api/v1/system/bootstrap.' -ForegroundColor DarkYellow
    Write-Host 'After owner setup, set APP_BOOTSTRAP_TOKEN= (keep the key but leave it blank) in .env, then recreate the API with: docker compose up -d --force-recreate api.' -ForegroundColor DarkYellow
    Write-Host ''
}

# Match the mPAY physical-device convention but discover the current host LAN IP.
$lanIp = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -notmatch '^(127\.|169\.254\.)' } |
    Select-Object -First 1
if (-not $lanIp) { $lanIp = '192.168.31.47' }

$androidBaseUrl = $env:BAJAJ_ANDROID_API_BASE_URL
if ([string]::IsNullOrWhiteSpace($androidBaseUrl)) {
    $androidBaseUrl = 'http://' + $lanIp + ':8080/'
}
$androidEnv = Join-Path $repoRoot 'apps/android/.env'
if (-not (Test-Path $androidEnv) -or -not [string]::IsNullOrWhiteSpace($env:BAJAJ_ANDROID_API_BASE_URL)) {
    "EXPO_PUBLIC_API_BASE_URL=$androidBaseUrl" | Set-Content -Path $androidEnv -Encoding ascii
} else {
    $configured = Get-Content $androidEnv | Where-Object { $_ -match '^\s*EXPO_PUBLIC_API_BASE_URL\s*=' } | Select-Object -First 1
    if ($configured) {
        $configuredUrl = ($configured -split '=', 2)[1].Trim().Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($configuredUrl)) { $androidBaseUrl = $configuredUrl }
    }
}

Write-Host "Android API  : $androidBaseUrl" -ForegroundColor DarkGray
Invoke-Compose -ComposeArgs @('config', '--quiet')
if ($Mode -eq 'Pull') {
    Write-Host "Pulling prebuilt GHCR API/web images (tag: $Tag)…" -ForegroundColor Cyan
    try {
        Invoke-Compose -ComposeArgs @('pull', 'api', 'customer-web', 'staff-web')
    } catch {
        Write-Host "If the GHCR packages are private, authenticate first with: docker login ghcr.io" -ForegroundColor Yellow
        Write-Host "Then rerun: .\scripts\start.ps1 -Mode Pull -Tag $Tag" -ForegroundColor Yellow
        throw
    }
    Invoke-Compose -ComposeArgs @('up', '--no-build', '-d')
} else {
    Write-Host 'Building API and both web images locally, then starting the full stack…' -ForegroundColor Cyan
    if ($Rebuild) { Invoke-Compose -ComposeArgs @('build', '--no-cache') }
    Invoke-Compose -ComposeArgs @('up', '--build', '-d')
}

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
            if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) { $pending += $check }
        } catch { $pending += $check }
    }
    if ($pending.Count -eq 0) { $ready = $true; break }
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
if ($null -eq $previousImageTag) { Remove-Item Env:BAJAJ_IMAGE_TAG -ErrorAction SilentlyContinue } else { $env:BAJAJ_IMAGE_TAG = $previousImageTag }
)]
    [string]$Tag = 'latest',
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

# Create a private ignored .env and a random one-time first-owner token.
$rootEnv = Join-Path $repoRoot '.env'
$generatedBootstrapToken = $false
$rootEnvContent = if (Test-Path $rootEnv) { Get-Content $rootEnv -Raw } else { '' }
if (-not (Test-Path $rootEnv) -or -not ($rootEnvContent -match '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=')) {
    $tokenBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
    $newToken = [BitConverter]::ToString($tokenBytes).Replace('-', '').ToLowerInvariant()
    if (-not (Test-Path $rootEnv)) {
        @"
POSTGRES_DB=bajaj_dealership
POSTGRES_USER=bajaj_app
POSTGRES_PASSWORD=bajaj_local_only
POSTGRES_PORT=5432
API_PORT=8080
CUSTOMER_WEB_PORT=3000
STAFF_WEB_PORT=3001
APP_BOOTSTRAP_TOKEN=$newToken
"@ | Set-Content -Path $rootEnv -Encoding ascii
    } elseif ($rootEnvContent -match '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=') {
        $rootEnvContent = $rootEnvContent -replace '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=.*$', "APP_BOOTSTRAP_TOKEN=$newToken"
        Set-Content -Path $rootEnv -Value $rootEnvContent -Encoding ascii
    } else {
        Add-Content -Path $rootEnv -Value "APP_BOOTSTRAP_TOKEN=$newToken" -Encoding ascii
    }
    $generatedBootstrapToken = $true
}

if ($generatedBootstrapToken) {
    $tokenContent = Get-Content $rootEnv -Raw
    $newTokenValue = [regex]::Match($tokenContent, '(?m)^\s*APP_BOOTSTRAP_TOKEN\s*=\s*(\S.*?)\s*$').Groups[1].Value.Trim().Trim('"').Trim("'")
    Write-Host ''
    Write-Host 'One-time initial owner setup token (local only):' -ForegroundColor Yellow
    Write-Host $newTokenValue -ForegroundColor Yellow
    Write-Host 'Use it in the X-Bootstrap-Token header for POST /api/v1/system/bootstrap.' -ForegroundColor DarkYellow
    Write-Host 'After owner setup, set APP_BOOTSTRAP_TOKEN= (keep the key but leave it blank) in .env, then recreate the API with: docker compose up -d --force-recreate api.' -ForegroundColor DarkYellow
    Write-Host ''
}

# Match the mPAY physical-device convention but discover the current host LAN IP.
$lanIp = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -notmatch '^(127\.|169\.254\.)' } |
    Select-Object -First 1
if (-not $lanIp) { $lanIp = '192.168.31.47' }

$androidBaseUrl = $env:BAJAJ_ANDROID_API_BASE_URL
if ([string]::IsNullOrWhiteSpace($androidBaseUrl)) {
    $androidBaseUrl = 'http://' + $lanIp + ':8080/'
}
$androidEnv = Join-Path $repoRoot 'apps/android/.env'
if (-not (Test-Path $androidEnv) -or -not [string]::IsNullOrWhiteSpace($env:BAJAJ_ANDROID_API_BASE_URL)) {
    "EXPO_PUBLIC_API_BASE_URL=$androidBaseUrl" | Set-Content -Path $androidEnv -Encoding ascii
} else {
    $configured = Get-Content $androidEnv | Where-Object { $_ -match '^\s*EXPO_PUBLIC_API_BASE_URL\s*=' } | Select-Object -First 1
    if ($configured) {
        $configuredUrl = ($configured -split '=', 2)[1].Trim().Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($configuredUrl)) { $androidBaseUrl = $configuredUrl }
    }
}

Write-Host "Android API  : $androidBaseUrl" -ForegroundColor DarkGray
Write-Host 'Building and starting PostgreSQL, Spring Boot API, customer web and staff web…' -ForegroundColor Cyan
Invoke-Compose -ComposeArgs @('config', '--quiet')
if ($Rebuild) { Invoke-Compose -ComposeArgs @('build', '--no-cache') }
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
            if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) { $pending += $check }
        } catch { $pending += $check }
    }
    if ($pending.Count -eq 0) { $ready = $true; break }
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
