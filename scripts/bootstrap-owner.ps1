[CmdletBinding()]
param(
    [string]$ApiBaseUrl = 'http://localhost:8080'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'compose.yaml'
$envFile = Join-Path $repoRoot '.env'

if (-not (Test-Path -LiteralPath $composeFile)) {
    throw "Cannot find compose.yaml in repository root: $repoRoot"
}
if (-not (Test-Path -LiteralPath $envFile)) {
    throw 'Local .env not found. Start the Docker stack first with scripts/start.ps1.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI was not found. Start Docker Desktop and retry.'
}

Push-Location $repoRoot
$plainPassword = $null
$plainConfirmation = $null
$passwordBstr = [IntPtr]::Zero
$confirmationBstr = [IntPtr]::Zero

try {
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Engine is unavailable. Start Docker Desktop and retry.'
    }

    # Prefer an explicit shell override, otherwise read the ignored local .env.
    $bootstrapToken = $env:APP_BOOTSTRAP_TOKEN
    if ([string]::IsNullOrWhiteSpace($bootstrapToken)) {
        $envLine = Get-Content -LiteralPath $envFile |
            Where-Object { $_ -match '^\s*APP_BOOTSTRAP_TOKEN\s*=' } |
            Select-Object -First 1

        if ($envLine) {
            $bootstrapToken = ($envLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
        }
    }

    if ([string]::IsNullOrWhiteSpace($bootstrapToken)) {
        throw 'APP_BOOTSTRAP_TOKEN is blank or missing in .env. Owner bootstrap may already be disabled; do not generate a new token blindly.'
    }

    try {
        $health = Invoke-RestMethod -Uri ($ApiBaseUrl.TrimEnd('/') + '/actuator/health') -TimeoutSec 5
        if ($health.status -and $health.status -ne 'UP') {
            throw "API health is '$($health.status)'."
        }
    } catch {
        throw "The Dockerized API at $ApiBaseUrl is not responding. Start the stack with scripts/start.ps1. Details: $($_.Exception.Message)"
    }

    Write-Host ''
    Write-Host 'Lucky Bajaj — first dealership owner setup' -ForegroundColor Cyan
    Write-Host 'The bootstrap token is read from .env and will not be printed.'
    Write-Host 'This creates the first owner; it does not activate an invited staff account.'
    Write-Host ''

    $dealershipCode = (Read-Host 'Dealership code (e.g. LUCKY-BAJAJ)').Trim().ToUpperInvariant()
    if ($dealershipCode -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$') {
        throw 'Dealership code must be 3–40 characters and contain only letters, numbers, underscores or hyphens.'
    }

    $dealershipName = (Read-Host 'Dealership name').Trim()
    if ([string]::IsNullOrWhiteSpace($dealershipName) -or $dealershipName.Length -gt 160) {
        throw 'Dealership name is required and must be at most 160 characters.'
    }

    $ownerName = (Read-Host 'Owner full name').Trim()
    if ([string]::IsNullOrWhiteSpace($ownerName) -or $ownerName.Length -gt 160) {
        throw 'Owner name is required and must be at most 160 characters.'
    }

    $emailInput = (Read-Host 'Owner email (leave blank if using phone)').Trim()
    $phoneInput = (Read-Host 'Owner phone (leave blank if using email)').Trim()
    if ([string]::IsNullOrWhiteSpace($emailInput) -and [string]::IsNullOrWhiteSpace($phoneInput)) {
        throw 'Provide at least an owner email or phone number.'
    }

    $securePassword = Read-Host 'Create owner password (12–72 characters)' -AsSecureString
    $secureConfirmation = Read-Host 'Confirm owner password' -AsSecureString

    try {
        $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $confirmationBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
        $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationBstr)
    } finally {
        if ($passwordBstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
            $passwordBstr = [IntPtr]::Zero
        }
        if ($confirmationBstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationBstr)
            $confirmationBstr = [IntPtr]::Zero
        }
        if ($securePassword) { $securePassword.Dispose() }
        if ($secureConfirmation) { $secureConfirmation.Dispose() }
    }

    if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 72) {
        throw 'Password must be 12–72 characters.'
    }
    if ([Text.Encoding]::UTF8.GetByteCount($plainPassword) -gt 72) {
        throw 'Password must be at most 72 UTF-8 bytes for the configured password hash.'
    }
    if ($plainPassword -ne $plainConfirmation) {
        throw 'The passwords do not match.'
    }

    $email = if ([string]::IsNullOrWhiteSpace($emailInput)) { $null } else { $emailInput }
    $phone = if ([string]::IsNullOrWhiteSpace($phoneInput)) { $null } else { $phoneInput }
    $payload = @{
        dealershipCode = $dealershipCode
        dealershipName = $dealershipName
        ownerName = $ownerName
        email = $email
        phone = $phone
        password = $plainPassword
    } | ConvertTo-Json -Depth 4 -Compress

    Write-Host ''
    Write-Host 'Creating the initial owner through the Dockerized API…' -ForegroundColor Cyan

    $request = @{
        Uri = $ApiBaseUrl.TrimEnd('/') + '/api/v1/system/bootstrap'
        Method = 'Post'
        Headers = @{ 'X-Bootstrap-Token' = $bootstrapToken }
        ContentType = 'application/json'
        Body = $payload
        TimeoutSec = 20
    }

    try {
        $result = Invoke-RestMethod @request
    } catch {
        $details = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace($details)) {
            $details = $_.Exception.Message
        } else {
            try {
                $parsed = $details | ConvertFrom-Json -ErrorAction Stop
                if ($parsed.message) { $details = [string]$parsed.message }
                elseif ($parsed.detail) { $details = [string]$parsed.detail }
            } catch {}
        }
        throw "Owner bootstrap failed: $details. If the token was just changed in .env, recreate the API container so it receives the updated value."
    }

    Write-Host ''
    Write-Host 'Initial owner created successfully.' -ForegroundColor Green
    Write-Host "Dealership code: $($result.dealershipCode)"
    Write-Host "Owner name:      $($result.ownerName)"
    Write-Host "Role:            $($result.role)"
    Write-Host ''
    Write-Host 'Next: sign in at http://localhost:3001 with the dealership code, owner email/phone and password you just set.'
    Write-Host 'After confirming owner sign-in, disable bootstrap by setting APP_BOOTSTRAP_TOKEN= in .env and run: docker compose up -d --force-recreate api'
} finally {
    $plainPassword = $null
    $plainConfirmation = $null
    $bootstrapToken = $null
    Pop-Location
}
