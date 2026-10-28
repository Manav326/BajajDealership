$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
& docker compose -f (Join-Path $repoRoot 'compose.yaml') down
if ($LASTEXITCODE -ne 0) { throw "docker compose down failed with exit code $LASTEXITCODE." }
Write-Host 'Services stopped. Named database/media volumes were preserved.' -ForegroundColor Green
