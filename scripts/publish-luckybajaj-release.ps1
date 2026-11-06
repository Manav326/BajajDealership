#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateRange(5, 120)]
    [int]$WaitTimeoutMinutes = 55,
    [switch]$SkipDeployment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:Repository = 'Manav326/BajajDealership'
$script:ApiBase = 'https://api-luckybajaj.quantaedge.in/'
$script:CustomerOrigin = 'https://luckybajaj.quantaedge.in'
$script:StaffOrigin = 'https://staff-luckybajaj.quantaedge.in'
$script:RequiredSecrets = @(
    'BAJAJ_ANDROID_SIGNING_KEYSTORE_BASE64',
    'BAJAJ_ANDROID_SIGNING_KEYSTORE_PASSWORD',
    'BAJAJ_ANDROID_SIGNING_KEY_ALIAS',
    'BAJAJ_ANDROID_SIGNING_KEY_PASSWORD'
)
$script:RequiredAssets = @(
    'LuckyBajaj-Android.apk',
    'LuckyBajaj-LiquidGlass-Android.apk',
    'LuckyBajajDesktopSetup.exe',
    'LuckyBajajDesktop.msi',
    'LuckyBajaj-Android-build.json',
    'LuckyBajaj-LiquidGlass-Android-build.json',
    'LuckyBajaj-Windows-build.json',
    'SHA256SUMS.txt',
    'release-manifest.json'
)

function Write-Stage {
    param([string]$Message)
    Write-Host ''
    Write-Host ('=== ' + $Message + ' ===') -ForegroundColor Cyan
}

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$GitArguments)
    $result = & git @GitArguments
    if ($LASTEXITCODE -ne 0) {
        throw ('git ' + ($GitArguments -join ' ') + ' failed with exit code ' + $LASTEXITCODE + '.')
    }
    return $result
}

function Get-RunsForCurrentCommit {
    $endpoint = 'repos/{0}/actions/runs?head_sha={1}&per_page=100' -f $script:Repository, $script:HeadSha
    $raw = & gh api $endpoint
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not read GitHub Actions runs. Confirm that gh is authenticated and has repository Actions read access.'
    }
    $jsonText = $raw -join [Environment]::NewLine
    $payload = $jsonText | ConvertFrom-Json
    return @($payload.workflow_runs)
}

function Get-LatestWorkflowRun {
    param(
        [object[]]$Runs,
        [string]$WorkflowPath
    )
    return $Runs |
        Where-Object { $_.path -eq $WorkflowPath } |
        Sort-Object -Property run_number -Descending |
        Select-Object -First 1
}

function Get-StableTagForHead {
    $tags = @(Invoke-Git -GitArguments @('tag', '--points-at', $script:HeadSha))
    $stable = @($tags | Where-Object { $_ -match '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' })
    if ($stable.Count -gt 1) {
        throw ('More than one stable version tag points at current main commit: ' + ($stable -join ', ') + '. Resolve this manually; no tag will be changed.')
    }
    if ($stable.Count -eq 1) { return [string]$stable[0] }
    return $null
}

function Test-GoogleOAuthConfiguration {
    $apps = @(
        [PSCustomObject]@{ Name = 'Standard'; Package = 'com.quantaedge.luckybajaj' },
        [PSCustomObject]@{ Name = 'Liquid Glass'; Package = 'com.quantaedge.luckybajajlg' }
    )
    foreach ($app in $apps) {
        $uri = $script:ApiBase + 'api/v1/customer/auth/google/config?applicationId=' + [Uri]::EscapeDataString($app.Package)
        try {
            $config = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Accept = 'application/json' } -TimeoutSec 25
        } catch {
            throw ('Could not verify the hosted Google sign-in configuration for ' + $app.Name + '. The API returned an error from this computer: ' + $_.Exception.Message)
        }
        if (
            $config.configured -ne $true -or
            [string]::IsNullOrWhiteSpace([string]$config.clientId) -or
            $config.androidConfigured -ne $true -or
            [string]::IsNullOrWhiteSpace([string]$config.androidClientId)
        ) {
            throw ($app.Name + ' Google sign-in is not fully configured. Both the web client and the matching Android client must be present.')
        }
        Write-Host ($app.Name + ': web and Android OAuth clients verified.') -ForegroundColor Green
    }
}

function Wait-ForMainCI {
    param([datetime]$Deadline)
    Write-Stage 'Wait for successful main CI'
    while ((Get-Date) -lt $Deadline) {
        $runs = Get-RunsForCurrentCommit
        $run = Get-LatestWorkflowRun -Runs $runs -WorkflowPath '.github/workflows/ci.yml'
        if ($null -ne $run) {
            Write-Host ('CI run #{0}: {1} / {2}' -f $run.run_number, $run.status, $run.conclusion)
            if ($run.status -eq 'completed') {
                if ($run.conclusion -ne 'success') {
                    throw ('CI did not pass for current main commit. Run details: ' + $run.html_url)
                }
                Write-Host ('CI passed: ' + $run.html_url) -ForegroundColor Green
                return
            }
        } else {
            Write-Host 'Waiting for the push-triggered CI run to appear...'
        }
        Start-Sleep -Seconds 15
    }
    throw ('Timed out waiting for main CI after ' + $WaitTimeoutMinutes + ' minutes. No local files or services were changed.')
}

function Start-ReleasePreparation {
    Write-Stage 'Dispatch release preparation after local preflight'
    & gh workflow run .github/workflows/auto-release-on-main-ci.yml --repo $script:Repository --ref main -f ('source_sha=' + $script:HeadSha)
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not dispatch release preparation. The OAuth and signing preflight passed, but GitHub Actions did not accept the workflow dispatch.'
    }
    Write-Host 'Release preparation dispatched for the exact current main commit.' -ForegroundColor Green
}

function Wait-ForAutomaticRelease {
    param([datetime]$Deadline)
    Write-Stage 'Wait for gated version allocation'
    while ((Get-Date) -lt $Deadline) {
        $null = Invoke-Git -GitArguments @('fetch', '--quiet', 'origin', '--tags')
        $runs = Get-RunsForCurrentCommit
        $tag = Get-StableTagForHead
        $run = Get-LatestWorkflowRun -Runs $runs -WorkflowPath '.github/workflows/auto-release-on-main-ci.yml'

        if ($null -ne $run) {
            Write-Host ('Auto-release run #{0}: {1} / {2}' -f $run.run_number, $run.status, $run.conclusion)
            if ($run.status -eq 'completed' -and $run.conclusion -ne 'success') {
                throw ('Automatic release preparation failed. Open the workflow run for its exact failure reason: ' + $run.html_url)
            }
            if ($run.status -eq 'completed' -and $run.conclusion -eq 'success' -and $tag) {
                Write-Host ('Version tag created for this exact commit: ' + $tag) -ForegroundColor Green
                return $tag
            }
        }

        if ($tag) {
            Write-Host ('Found version tag ' + $tag + '; waiting for automatic release preparation to finish...')
        } else {
            Write-Host 'Waiting for the successful CI run to allocate a stable version tag...'
        }
        Start-Sleep -Seconds 15
    }
    throw ('Timed out waiting for automatic release version allocation. No tag was created or moved by this script.')
}

function Wait-ForPublishedRelease {
    param(
        [string]$Tag,
        [datetime]$Deadline
    )
    Write-Stage ('Wait for published release ' + $Tag)
    while ((Get-Date) -lt $Deadline) {
        $runs = Get-RunsForCurrentCommit
        $run = Get-LatestWorkflowRun -Runs $runs -WorkflowPath '.github/workflows/release.yml'
        if ($null -ne $run) {
            Write-Host ('Release run #{0}: {1} / {2}' -f $run.run_number, $run.status, $run.conclusion)
            if ($run.status -eq 'completed' -and $run.conclusion -ne 'success') {
                throw ('The versioned release build failed. Open the workflow run for its exact failure reason: ' + $run.html_url)
            }
            if ($run.status -eq 'completed' -and $run.conclusion -eq 'success') {
                Write-Host ('Release build passed: ' + $run.html_url) -ForegroundColor Green
                return
            }
        } else {
            Write-Host 'Waiting for the tag-specific release workflow to appear...'
        }
        Start-Sleep -Seconds 20
    }
    throw ('Timed out waiting for release ' + $Tag + '. The Actions run may still be building; check GitHub Actions before rerunning.')
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]]$ComposeArguments)
    $allArguments = @($script:ComposeFiles) + @($ComposeArguments)
    $output = & docker compose @allArguments
    if ($LASTEXITCODE -ne 0) {
        throw ('docker compose ' + ($ComposeArguments -join ' ') + ' failed with exit code ' + $LASTEXITCODE + '.')
    }
    return $output
}

function Get-ComposeLocalBaseUrl {
    param(
        [string]$Service,
        [int]$ContainerPort
    )
    $output = Invoke-Compose -ComposeArguments @('port', $Service, [string]$ContainerPort)
    $entries = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    $binding = if ($entries.Count -gt 0) { [string]$entries[0] } else { '' }
    $match = [Regex]::Match($binding.Trim(), ':(\d+)$')
    if (-not $match.Success) {
        throw ('Could not resolve the local port for Compose service ' + $Service + '. docker compose port returned: ' + $binding)
    }
    return 'http://127.0.0.1:' + $match.Groups[1].Value
}

function Test-PublicSite {
    param([string]$Name, [string]$Uri)
    try {
        $response = Invoke-WebRequest -Uri $Uri -Method Get -UseBasicParsing -TimeoutSec 25
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
            throw ('HTTP ' + $response.StatusCode)
        }
        Write-Host ($Name + ': HTTP ' + $response.StatusCode) -ForegroundColor Green
    } catch {
        throw ($Name + ' did not respond successfully at ' + $Uri + '. ' + $_.Exception.Message)
    }
}

function Test-PublicDownloadRoutes {
    param([string]$BaseUri)

    Add-Type -AssemblyName System.Net.Http
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(100)
    $routes = @(
        [PSCustomObject]@{ Platform = 'android-standard'; File = 'LuckyBajaj-Android.apk' },
        [PSCustomObject]@{ Platform = 'android-liquid-glass'; File = 'LuckyBajaj-LiquidGlass-Android.apk' },
        [PSCustomObject]@{ Platform = 'windows-exe'; File = 'LuckyBajajDesktopSetup.exe' },
        [PSCustomObject]@{ Platform = 'windows-msi'; File = 'LuckyBajajDesktop.msi' }
    )

    try {
        foreach ($route in $routes) {
            $uri = $BaseUri.TrimEnd('/') + '/api/v1/public/downloads/' + $route.Platform
            $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $uri)
            $request.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::new(0, 0)
            $response = $null
            try {
                $response = $client.SendAsync(
                    $request,
                    [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
                ).GetAwaiter().GetResult()

                $statusCode = [int]$response.StatusCode
                if ($statusCode -ne 200 -and $statusCode -ne 206) {
                    throw ('HTTP ' + $statusCode)
                }

                $disposition = $response.Content.Headers.ContentDisposition
                if ($null -eq $disposition) {
                    throw 'The response did not include Content-Disposition.'
                }
                $actualName = [string]$disposition.FileNameStar
                if ([string]::IsNullOrWhiteSpace($actualName)) { $actualName = [string]$disposition.FileName }
                $actualName = $actualName.Trim().Trim('"')
                if ($actualName -ne $route.File) {
                    throw ('Expected ' + $route.File + ' but the server returned ' + $actualName + '.')
                }
                if ($response.Content.Headers.ContentLength -eq 0) {
                    throw 'The download response is empty.'
                }
                Write-Host ($route.Platform + ': HTTP ' + $statusCode + ', correct file name.') -ForegroundColor Green
            } finally {
                if ($null -ne $response) { $response.Dispose() }
                $request.Dispose()
            }
        }
    } finally {
        $client.Dispose()
    }
}

try {
    Write-Stage 'Repository and tool preflight'
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Set-Location $repoRoot

    foreach ($tool in @('git', 'gh', 'docker')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw ($tool + ' was not found in PATH. Install it and reopen PowerShell.')
        }
    }

    $branch = [string](Invoke-Git -GitArguments @('branch', '--show-current'))
    if ($branch.Trim() -ne 'main') {
        throw ('Run this script from the main branch. Current branch: ' + $branch.Trim())
    }

    $origin = [string](Invoke-Git -GitArguments @('remote', 'get-url', 'origin'))
    if ($origin.Trim() -notmatch 'github\.com[:/]Manav326/BajajDealership(?:\.git)?$') {
        throw ('The origin remote is not Manav326/BajajDealership: ' + $origin.Trim())
    }

    $null = Invoke-Git -GitArguments @('fetch', '--quiet', 'origin', 'main', '--tags', '--prune')
    $script:HeadSha = [string](Invoke-Git -GitArguments @('rev-parse', 'HEAD'))
    $remoteSha = [string](Invoke-Git -GitArguments @('rev-parse', 'origin/main'))
    if ($script:HeadSha.Trim() -ne $remoteSha.Trim()) {
        throw ('Local main is not exactly origin/main. Run git pull --ff-only origin main, then rerun this script. Local: ' + $script:HeadSha.Trim() + '; remote: ' + $remoteSha.Trim())
    }
    $script:HeadSha = $script:HeadSha.Trim()

    $dirty = @(Invoke-Git -GitArguments @('status', '--porcelain'))
    Write-Host ('Source commit: ' + $script:HeadSha) -ForegroundColor White
    if ($dirty.Count -gt 0) {
        Write-Host ('Detected ' + $dirty.Count + ' local changed/untracked path(s). They will be left untouched; this script never stages, stashes, resets, cleans or commits local files.') -ForegroundColor Yellow
    } else {
        Write-Host 'Working tree has no local changes.'
    }

    & gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub CLI is not authenticated. Run gh auth login --hostname github.com, then rerun this script.'
    }

    Write-Stage 'Verify release prerequisites from this computer'
    $secretJson = & gh api ('repos/' + $script:Repository + '/actions/secrets?per_page=100')
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not list repository Actions secret names. Confirm your GitHub account can read repository Actions secrets.'
    }
    $secretJsonText = $secretJson -join [Environment]::NewLine
    $secretPayload = $secretJsonText | ConvertFrom-Json
    $secretNames = @($secretPayload.secrets | ForEach-Object { [string]$_.name })
    $missingSecrets = @($script:RequiredSecrets | Where-Object { $_ -notin $secretNames })
    if ($missingSecrets.Count -gt 0) {
        throw ('Missing repository Actions secret names: ' + ($missingSecrets -join ', ') + '. Secret values are never read or displayed by this script.')
    }
    Write-Host 'All four Android signing secret names are present in GitHub. Values were not read.' -ForegroundColor Green

    Test-GoogleOAuthConfiguration

    $deadline = (Get-Date).AddMinutes($WaitTimeoutMinutes)
    Wait-ForMainCI -Deadline $deadline
    Start-ReleasePreparation
    $tag = Wait-ForAutomaticRelease -Deadline $deadline
    Wait-ForPublishedRelease -Tag $tag -Deadline $deadline

    Write-Stage 'Verify the published release and its assets'
    $releaseRaw = & gh release view $tag --repo $script:Repository --json tagName,isDraft,isPrerelease,url,assets
    if ($LASTEXITCODE -ne 0) {
        throw ('The release tag exists but GitHub could not return its release metadata: ' + $tag)
    }
    $release = ($releaseRaw -join [Environment]::NewLine) | ConvertFrom-Json
    if ($release.isDraft -or $release.isPrerelease) {
        throw ('Release ' + $tag + ' is not a published stable release.')
    }

    $assetNames = @($release.assets | ForEach-Object { [string]$_.name })
    $missingAssets = @($script:RequiredAssets | Where-Object { $_ -notin $assetNames })
    if ($missingAssets.Count -gt 0) {
        throw ('Release ' + $tag + ' is missing required assets: ' + ($missingAssets -join ', '))
    }
    foreach ($asset in $release.assets) {
        if ($asset.name -in $script:RequiredAssets -and [long]$asset.size -le 0) {
            throw ('Release asset is empty: ' + $asset.name)
        }
    }

    $tagSha = [string](Invoke-Git -GitArguments @('rev-parse', ($tag + '^{commit}')))
    if ($tagSha.Trim() -ne $script:HeadSha) {
        throw ('Published release tag ' + $tag + ' points to ' + $tagSha.Trim() + ', not the tested main commit ' + $script:HeadSha + '. Deployment is blocked.')
    }
    Write-Host ('Published release: ' + $release.url) -ForegroundColor Green
    Write-Host ('Version: ' + $tag + ' | Source: ' + $script:HeadSha) -ForegroundColor Green
    Write-Host 'All four binaries, all three build metadata files, SHA256SUMS.txt and release-manifest.json are present and non-empty.' -ForegroundColor Green

    if ($SkipDeployment) {
        Write-Host ''
        Write-Host 'Release verification completed. Local Docker deployment was skipped by request.' -ForegroundColor Yellow
        return
    }

    Write-Stage 'Check the existing Cloudflare tunnel stack'
    $composePath = Join-Path $repoRoot 'compose.yaml'
    $edgePath = Join-Path $repoRoot 'compose.edge.yaml'
    $envPath = Join-Path $repoRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw 'The local .env file is missing. Restore your existing private local configuration; this script will not generate or overwrite it.'
    }
    if (-not (Test-Path -LiteralPath $edgePath -PathType Leaf)) {
        throw 'Your local compose.edge.yaml Cloudflare tunnel overlay is missing. Restore that local untracked file before deployment. It is intentionally not stored in Git.'
    }

    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Engine is not running. Start Docker Desktop and rerun the script.'
    }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose v2 is required (docker compose).'
    }

    $script:ComposeFiles = @('-f', $composePath, '-f', $edgePath)
    $previousImageTag = $env:BAJAJ_IMAGE_TAG
    $hadPreviousImageTag = Test-Path Env:BAJAJ_IMAGE_TAG
    $env:BAJAJ_IMAGE_TAG = 'sha-' + $script:HeadSha

    try {
        $null = Invoke-Compose -ComposeArguments @('config', '--quiet')

        $postgresIdOutput = Invoke-Compose -ComposeArguments @('ps', '-q', 'postgres')
        $postgresIds = @($postgresIdOutput | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        $postgresId = if ($postgresIds.Count -gt 0) { [string]$postgresIds[0] } else { '' }
        if ([string]::IsNullOrWhiteSpace($postgresId)) {
            throw 'The existing PostgreSQL container was not found. Start and verify the current stack first; this script will not recreate or reset the database.'
        }
        $postgresState = [string](& docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $postgresId)
        if ($LASTEXITCODE -ne 0 -or $postgresState.Trim() -ne 'running|healthy') {
            throw ('PostgreSQL is not already healthy (' + $postgresState.Trim() + '). Database deployment is blocked.')
        }
        Write-Host 'Existing PostgreSQL container is running and healthy. Its volume will not be touched.' -ForegroundColor Green

        Write-Stage ('Pull exact GHCR images for sha-' + $script:HeadSha)
        $null = Invoke-Compose -ComposeArguments @('pull', 'api', 'customer-web', 'staff-web')

        Write-Stage 'Update only the API and two web containers'
        $null = Invoke-Compose -ComposeArguments @('up', '--no-deps', '--no-build', '-d', 'api', 'customer-web', 'staff-web')
        Write-Host 'The PostgreSQL service, named volumes and Cloudflare tunnel container were not restarted.' -ForegroundColor Green

        $localApi = Get-ComposeLocalBaseUrl -Service 'api' -ContainerPort 8080
        $localCustomer = Get-ComposeLocalBaseUrl -Service 'customer-web' -ContainerPort 80
        $localStaff = Get-ComposeLocalBaseUrl -Service 'staff-web' -ContainerPort 80

        Write-Stage 'Wait for local containers to become healthy'
        $localReady = $false
        for ($attempt = 1; $attempt -le 60; $attempt++) {
            try {
                $health = Invoke-RestMethod -Uri ($localApi + '/actuator/health') -TimeoutSec 8
                $customerResponse = Invoke-WebRequest -Uri ($localCustomer + '/') -UseBasicParsing -TimeoutSec 8
                $staffResponse = Invoke-WebRequest -Uri ($localStaff + '/') -UseBasicParsing -TimeoutSec 8
                if (
                    $health.status -eq 'UP' -and
                    $customerResponse.StatusCode -ge 200 -and $customerResponse.StatusCode -lt 400 -and
                    $staffResponse.StatusCode -ge 200 -and $staffResponse.StatusCode -lt 400
                ) {
                    $localReady = $true
                    break
                }
            } catch {
                # Give the new containers time to finish startup; no database or tunnel action is taken here.
            }
            Start-Sleep -Seconds 5
        }
        if (-not $localReady) {
            throw ('Local health checks did not all pass. API: ' + $localApi + '; Customer: ' + $localCustomer + '; Staff: ' + $localStaff + '. Inspect docker compose logs for api, customer-web and staff-web.')
        }
        Write-Host 'Local API, customer web and staff web are responding.' -ForegroundColor Green
    } finally {
        if ($hadPreviousImageTag) {
            $env:BAJAJ_IMAGE_TAG = $previousImageTag
        } else {
            Remove-Item Env:BAJAJ_IMAGE_TAG -ErrorAction SilentlyContinue
        }
    }

    Write-Stage 'Verify Cloudflare public websites and release status'
    Test-PublicSite -Name 'Customer website' -Uri ($script:CustomerOrigin + '/')
    Test-PublicSite -Name 'Staff portal' -Uri ($script:StaffOrigin + '/')

    $publicStatusUri = $script:ApiBase.TrimEnd('/') + '/api/v1/public/downloads/status'
    try {
        $downloadStatus = Invoke-RestMethod -Method Get -Uri $publicStatusUri -Headers @{ Accept = 'application/json' } -TimeoutSec 30
    } catch {
        throw ('The public release-status endpoint failed: ' + $_.Exception.Message)
    }

    if ([string]$downloadStatus.version -ne $tag) {
        throw ('The public download API reports version ' + [string]$downloadStatus.version + ' instead of ' + $tag + '. The public API may still be serving an older image or release cache.')
    }

    $availability = @(
        [PSCustomObject]@{ Name = 'Standard Android'; Available = $downloadStatus.androidStandardAvailable },
        [PSCustomObject]@{ Name = 'Liquid Glass Android'; Available = $downloadStatus.androidLiquidGlassAvailable },
        [PSCustomObject]@{ Name = 'Windows EXE'; Available = $downloadStatus.windowsExeAvailable },
        [PSCustomObject]@{ Name = 'Windows MSI'; Available = $downloadStatus.windowsMsiAvailable }
    )
    $unavailable = @($availability | Where-Object { $_.Available -ne $true })
    if ($unavailable.Count -gt 0) {
        throw ('The public download API has not exposed all assets: ' + (($unavailable | ForEach-Object { $_.Name }) -join ', '))
    }
    Write-Host ('Public API now advertises complete release ' + $tag + ' with all four packages.') -ForegroundColor Green

    Test-GoogleOAuthConfiguration
    Test-PublicDownloadRoutes -BaseUri $script:ApiBase

    Test-PublicSite -Name 'Public API health' -Uri ($script:ApiBase.TrimEnd('/') + '/actuator/health')

    Write-Host ''
    Write-Host 'LUCKY BAJAJ RELEASE AND DEPLOYMENT VERIFIED' -ForegroundColor Green
    Write-Host ('Release       : ' + $tag)
    Write-Host ('Source commit : ' + $script:HeadSha)
    Write-Host ('Customer site : ' + $script:CustomerOrigin)
    Write-Host ('Staff portal  : ' + $script:StaffOrigin)
    Write-Host ('API           : ' + $script:ApiBase)
    Write-Host 'Downloads     : Standard APK, Liquid Glass APK, Windows EXE and MSI'
    Write-Host ('Release page  : ' + $release.url)
    Write-Host ''
    Write-Host 'Safety: no local changes were staged, stashed, reset, cleaned or committed; .env and compose.edge.yaml were not changed; PostgreSQL and its volumes were not recreated; the tunnel container was not restarted.' -ForegroundColor Green
} catch {
    Write-Host ''
    Write-Host ('STOPPED: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'No Git commit, tag, local configuration edit, database reset or volume deletion is performed by this script.' -ForegroundColor Yellow
    exit 1
}
