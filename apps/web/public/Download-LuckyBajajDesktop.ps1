[CmdletBinding()]
param(
  [ValidateSet('Auto', 'Build', 'Pull')]
  [string]$Mode = 'Auto',
  [string]$Branch = 'main',
  [string]$DownloadRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\LuckyBajajDesktopLocalDocker')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = 'Manav326/BajajDealership'
$apiRoot = "https://api.github.com/repos/$repository"
$desktopJobName = 'Build unsigned Windows desktop installers'
$artifactPrefix = 'lucky-bajaj-windows-builds-'
$webRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $webRoot)
$resolvedRoot = [System.IO.Path]::GetFullPath($DownloadRoot)
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stagingName = '.LuckyBajajDesktop-staging-' + [Guid]::NewGuid().ToString('N')
$stagingDirectory = Join-Path $resolvedRoot $stagingName
$workDirectory = Join-Path $env:TEMP ('lucky-bajaj-desktop-' + [Guid]::NewGuid().ToString('N'))
$finalDirectory = $null
$backupDirectory = $null

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-GitHubHeaders {
  $token = $env:GH_TOKEN
  if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:GITHUB_TOKEN }

  if ([string]::IsNullOrWhiteSpace($token)) {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
      $tokenOutput = @(& gh auth token 2>$null)
      if ($LASTEXITCODE -eq 0 -and $tokenOutput.Count -gt 0) {
        $token = ([string]$tokenOutput[0]).Trim()
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "GitHub Actions artifact access needs authentication. Install GitHub CLI and run 'gh auth login', or set GH_TOKEN/GITHUB_TOKEN with Actions: read permission."
  }

  return @{
    Authorization = "Bearer $token"
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'LuckyBajajDesktop-Installer-Downloader'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
}

function Invoke-GitHubApi {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][hashtable]$Headers
  )

  $uri = "$script:apiRoot/$Path"
  try {
    return Invoke-RestMethod -Uri $uri -Headers $Headers -Method Get
  } catch {
    throw "GitHub API request failed for '$Path': $($_.Exception.Message)"
  }
}

function Test-UnsignedInstallers {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileInfo[]]$Installers
  )

  foreach ($installer in $Installers) {
    $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    if ($signature.Status -ne 'NotSigned') {
      throw "Expected unsigned direct installer '$($installer.Name)'; found signature status '$($signature.Status)'."
    }
  }
}

function Find-LatestCiInstaller {
  param([Parameter(Mandatory = $true)][string]$Destination)

  $headers = Get-GitHubHeaders
  $encodedBranch = [Uri]::EscapeDataString($Branch)
  $runsResponse = Invoke-GitHubApi -Path "actions/runs?branch=$encodedBranch&per_page=100" -Headers $headers
  $candidates = @(
    $runsResponse.workflow_runs |
      Where-Object {
        $_.head_branch -eq $Branch -and
        $_.event -in @('push', 'workflow_dispatch') -and
        $_.status -eq 'completed' -and
        $_.conclusion -eq 'success' -and
        $_.head_sha -match '^[0-9a-f]{40}$'
      } |
      Sort-Object { [DateTime]$_.created_at } -Descending
  )

  if ($candidates.Count -eq 0) {
    Write-Warning "No successful CI runs were found on '$Branch'."
    return $null
  }

  foreach ($run in $candidates) {
    Write-Host "Checking Windows installer from CI run $($run.id), commit $($run.head_sha.Substring(0, 12))..." -ForegroundColor DarkCyan

    try {
      $jobsResponse = Invoke-GitHubApi -Path "actions/runs/$($run.id)/jobs?per_page=100" -Headers $headers
      $desktopJob = @($jobsResponse.jobs | Where-Object { $_.name -eq $desktopJobName } | Select-Object -First 1)
      if ($desktopJob.Count -eq 0 -or
          $desktopJob[0].status -ne 'completed' -or
          $desktopJob[0].conclusion -ne 'success') {
        Write-Host "  Windows installer job is not successful in this run; checking an earlier successful run." -ForegroundColor DarkGray
        continue
      }

      $expectedArtifactName = "$artifactPrefix$($run.head_sha)"
      $artifactsResponse = Invoke-GitHubApi -Path "actions/runs/$($run.id)/artifacts?per_page=100" -Headers $headers
      $artifact = @(
        $artifactsResponse.artifacts |
          Where-Object { $_.name -ceq $expectedArtifactName -and -not $_.expired } |
          Select-Object -First 1
      )
      if ($artifact.Count -eq 0) {
        Write-Host "  No Windows installer artifact in this run; checking an earlier successful run." -ForegroundColor DarkGray
        continue
      }

      if ([string]$artifact[0].digest -notmatch '^sha256:([a-fA-F0-9]{64})$') {
        Write-Warning "  Artifact '$expectedArtifactName' has no valid SHA-256 digest; skipping it."
        continue
      }
      $expectedHash = $Matches[1].ToLowerInvariant()
      $runDirectory = Join-Path $Destination ([string]$run.id)
      $extractDirectory = Join-Path $runDirectory 'extracted'
      $archivePath = Join-Path $runDirectory 'installer-artifact.zip'
      New-Item -ItemType Directory -Path $extractDirectory -Force | Out-Null

      $artifactUrl = "$script:apiRoot/actions/artifacts/$($artifact[0].id)/zip"
      Invoke-WebRequest -Uri $artifactUrl -Headers $headers -OutFile $archivePath -MaximumRedirection 10 -UseBasicParsing

      if ($artifact[0].size_in_bytes -and
          (Get-Item -LiteralPath $archivePath).Length -ne [long]$artifact[0].size_in_bytes) {
        throw "Downloaded artifact size does not match GitHub metadata for run $($run.id)."
      }

      $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualHash -ne $expectedHash) {
        throw "Downloaded artifact SHA-256 does not match GitHub metadata for run $($run.id)."
      }

      Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
      $exeFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.exe' -File -Recurse)
      $msiFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.msi' -File -Recurse)
      if ($exeFiles.Count -ne 1 -or $msiFiles.Count -ne 1) {
        throw "Expected one EXE and one MSI in '$expectedArtifactName'; found $($exeFiles.Count) EXE and $($msiFiles.Count) MSI."
      }

      Test-UnsignedInstallers -Installers @($exeFiles[0], $msiFiles[0])
      return [pscustomobject]@{
        Source = 'CI'
        Branch = $Branch
        HeadSha = [string]$run.head_sha
        RunUrl = [string]$run.html_url
        ArtifactName = $expectedArtifactName
        ArtifactSha256 = $actualHash
        ExePath = $exeFiles[0].FullName
        MsiPath = $msiFiles[0].FullName
      }
    } catch {
      Write-Warning "  Could not use CI run $($run.id): $($_.Exception.Message)"
      Write-Host "  Checking the next older successful run..." -ForegroundColor DarkGray
    }
  }

  return $null
}

function Get-LocalSourceInfo {
  $commit = 'unknown'
  $sourceBranch = 'unknown'
  $workingTreeDirty = $false

  if (Get-Command git -ErrorAction SilentlyContinue) {
    $commitOutput = @(& git -C $repoRoot rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $commitOutput.Count -gt 0) {
      $commit = ([string]$commitOutput[0]).Trim()
    }

    $branchOutput = @(& git -C $repoRoot branch --show-current 2>$null)
    if ($LASTEXITCODE -eq 0 -and $branchOutput.Count -gt 0) {
      $sourceBranch = ([string]$branchOutput[0]).Trim()
    }

    $statusOutput = @(& git -C $repoRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -eq 0) {
      $workingTreeDirty = $statusOutput.Count -gt 0
    }
  }

  return [pscustomobject]@{
    Commit = $commit
    Branch = $sourceBranch
    WorkingTreeDirty = $workingTreeDirty
  }
}

function Build-LocalDockerInstaller {
  Write-Step 'Building the local-Docker Windows desktop installer from this checkout'

  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $cargo = Get-Command cargo -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw 'Node.js 24+ and npm are required. Install Node.js 24 LTS, reopen PowerShell, and retry.'
  }
  if (-not $cargo) {
    throw 'Rust and Cargo are required by Tauri. Install the stable Rust toolchain for the MSVC target, then retry.'
  }

  $nodeVersion = (& node --version 2>&1 | Out-String).Trim()
  $nodeMatch = [regex]::Match($nodeVersion, '^v(?<major>\d+)')
  if (-not $nodeMatch.Success -or [int]$nodeMatch.Groups['major'].Value -lt 24) {
    throw "Node.js 24+ is required. Detected '$nodeVersion'."
  }

  $sourceInfo = Get-LocalSourceInfo
  if ($sourceInfo.WorkingTreeDirty) {
    Write-Warning 'The working tree has uncommitted changes. The installer will include the current local files.'
  }

  $previousAppVersion = $env:VITE_APP_VERSION
  $exeDirectory = Join-Path $webRoot 'src-tauri/target/release/bundle/nsis'
  $msiDirectory = Join-Path $webRoot 'src-tauri/target/release/bundle/msi'

  try {
    $env:VITE_APP_VERSION = '0.1.0-local'

    Push-Location $webRoot
    try {
      Write-Host 'Installing staff web and Tauri dependencies...' -ForegroundColor Cyan
      & npm.cmd install --no-package-lock --prefer-offline --no-audit --no-fund 2>&1 | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE."
      }

      Write-Host 'Building unsigned NSIS EXE and MSI installers...' -ForegroundColor Cyan
      & npm.cmd run tauri:build 2>&1 | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw "Tauri desktop build failed with exit code $LASTEXITCODE."
      }
    } finally {
      Pop-Location
    }
  } finally {
    if ($null -eq $previousAppVersion) { Remove-Item Env:VITE_APP_VERSION -ErrorAction SilentlyContinue }
    else { $env:VITE_APP_VERSION = $previousAppVersion }
  }

  $exeFiles = @(Get-ChildItem -LiteralPath $exeDirectory -Filter '*.exe' -File -ErrorAction SilentlyContinue)
  $msiFiles = @(Get-ChildItem -LiteralPath $msiDirectory -Filter '*.msi' -File -ErrorAction SilentlyContinue)
  if ($exeFiles.Count -ne 1 -or $msiFiles.Count -ne 1) {
    throw "Tauri build completed but did not produce exactly one EXE and one MSI. Found $($exeFiles.Count) EXE and $($msiFiles.Count) MSI."
  }

  Test-UnsignedInstallers -Installers @($exeFiles[0], $msiFiles[0])
  return [pscustomobject]@{
    Source = 'Local'
    Branch = $sourceInfo.Branch
    HeadSha = $sourceInfo.Commit
    RunUrl = ''
    ArtifactName = ''
    ArtifactSha256 = ''
    ExePath = $exeFiles[0].FullName
    MsiPath = $msiFiles[0].FullName
    WorkingTreeDirty = $sourceInfo.WorkingTreeDirty
  }
}

try {
  New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

  Write-Host ''
  Write-Host 'QuantaEdge | Lucky Bajaj — Windows desktop installer' -ForegroundColor Cyan
  Write-Host "Mode         : $Mode"
  Write-Host "Source branch: $Branch"
  Write-Host "Download to  : $resolvedRoot"
  Write-Host ''

  $installer = $null
  if ($Mode -in @('Auto', 'Pull')) {
    Write-Step "Looking for the newest successful Windows installer on '$Branch'"
    try {
      $installer = Find-LatestCiInstaller -Destination $workDirectory
    } catch {
      if ($Mode -eq 'Pull') { throw }
      Write-Warning "CI artifact lookup failed. Auto mode will build locally instead. Details: $($_.Exception.Message)"
    }

    if (-not $installer -and $Mode -eq 'Pull') {
      throw "No successful Windows EXE/MSI artifact was found in the 100 most recent successful '$Branch' CI runs. Nothing was downloaded. Run with -Mode Build to create installers from the current checkout."
    }
  }

  if (-not $installer) {
    if ($Mode -eq 'Pull') {
      throw 'Pull mode did not find a usable CI installer artifact.'
    }
    $installer = Build-LocalDockerInstaller
  }

  Copy-Item -LiteralPath $installer.ExePath -Destination (Join-Path $stagingDirectory ([IO.Path]::GetFileName($installer.ExePath)))
  Copy-Item -LiteralPath $installer.MsiPath -Destination (Join-Path $stagingDirectory ([IO.Path]::GetFileName($installer.MsiPath)))

  $exeName = [IO.Path]::GetFileName($installer.ExePath)
  $msiName = [IO.Path]::GetFileName($installer.MsiPath)
  $exePath = Join-Path $stagingDirectory $exeName
  $msiPath = Join-Path $stagingDirectory $msiName
  $exeHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $msiHash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $sourceLabel = if ($installer.Source -eq 'CI') { 'CI' } else { 'Local build' }
  $safeSha = if ($installer.HeadSha -match '^[0-9a-f]{12,40}$') { $installer.HeadSha.Substring(0, 12).ToLowerInvariant() } else { 'unknown' }
  $folderSuffix = if ($installer.Source -eq 'CI') { $safeSha } else { 'local-' + $timestamp }
  $finalDirectory = Join-Path $resolvedRoot "LuckyBajajDesktop-LocalDocker-$folderSuffix"

  if ($installer.Source -eq 'CI') {
    $sourceDescription = @(
      "CI run: $($installer.RunUrl)",
      "Artifact: $($installer.ArtifactName)",
      "Artifact archive SHA-256: $($installer.ArtifactSha256)"
    ) -join [Environment]::NewLine
  } else {
    $sourceDescription = @(
      "Local branch: $($installer.Branch)",
      "Local source commit: $($installer.HeadSha)",
      "Working tree had uncommitted changes: $($installer.WorkingTreeDirty)"
    ) -join [Environment]::NewLine
  }

  $installGuide = @"
LUCKY BAJAJ DESKTOP — LOCAL DOCKER TEST INSTALLATION
Installer source: $sourceLabel
$sourceDescription

CONNECTION TARGETS:
This single installer supports both the hosted service and Local Docker.
Hosted Lucky Bajaj is selected by default and is the normal customer setting.
For local testing, choose "Local Docker on this computer" in the Server connection
selector on the sign-in screen. That option calls http://127.0.0.1:8080.
The selected connection is saved on this Windows installation until changed.

STEP 1 — Start the local stack (only when testing locally)
1. Open PowerShell in the BajajDealership checkout you want to test.
2. Build/start the local backend and both websites:
   .\scripts\start.ps1
3. Confirm the API is healthy:
   Invoke-RestMethod http://127.0.0.1:8080/actuator/health
   Continue only when the response reports status UP.

STEP 2 — Install and choose the connection
1. Close Lucky Bajaj Desktop if it is running.
2. Choose ONE installer from this folder; do not run both:
   EXE: $exeName — guided setup.
   MSI: $msiName — Windows Installer.
3. Double-click the chosen installer and complete setup.
4. Open Lucky Bajaj Desktop from the Windows Start menu.
5. On the sign-in screen, select Hosted Lucky Bajaj service for normal use,
   or Local Docker on this computer for local testing.
6. Sign in with your existing Lucky Bajaj staff account.

Do not leave Local Docker selected when you intend to use the hosted customer service.
Local Docker mode requires the API to be running on this same computer.

SECURITY AND UPDATE NOTES
- Direct-download EXE/MSI packages are intentionally unsigned and may show Unknown Publisher or SmartScreen warnings. Do not disable Windows security protections.
- EXE SHA-256: $exeHash
- MSI SHA-256: $msiHash
- Keep using the same installer type for later upgrades. Download-folder cleanup does not uninstall the app, modify Docker data, or remove unrelated files.
"@

  [System.IO.File]::WriteAllText(
    (Join-Path $stagingDirectory 'INSTALL.txt'),
    $installGuide,
    [System.Text.UTF8Encoding]::new($false)
  )
  $buildInfo = @(
    "Installer source: $sourceLabel",
    "Branch: $($installer.Branch)",
    "Commit: $($installer.HeadSha)",
    "CI run: $($installer.RunUrl)",
    "Artifact: $($installer.ArtifactName)",
    "EXE SHA-256: $exeHash",
    "MSI SHA-256: $msiHash"
  ) -join [Environment]::NewLine
  [System.IO.File]::WriteAllText(
    (Join-Path $stagingDirectory 'BUILD-INFO.txt'),
    $buildInfo + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )

  if (Test-Path -LiteralPath $finalDirectory) {
    $backupDirectory = Join-Path $resolvedRoot ('.LuckyBajajDesktop-backup-' + [Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $finalDirectory -Destination $backupDirectory
  }
  try {
    Move-Item -LiteralPath $stagingDirectory -Destination $finalDirectory
  } catch {
    if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory) -and -not (Test-Path -LiteralPath $finalDirectory)) {
      Move-Item -LiteralPath $backupDirectory -Destination $finalDirectory
      $backupDirectory = $null
    }
    throw
  }

  if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
    Remove-Item -LiteralPath $backupDirectory -Recurse -Force
    $backupDirectory = $null
  }

  $oldFolders = @(
    Get-ChildItem -LiteralPath $resolvedRoot -Directory |
      Where-Object {
        $_.Name -match '^LuckyBajajDesktop-LocalDocker-(?:[0-9a-f]{12}|local-\d{8}-\d{6})$' -and
        $_.FullName -ne $finalDirectory
      }
  )
  foreach ($oldFolder in $oldFolders) {
    try {
      Remove-Item -LiteralPath $oldFolder.FullName -Recurse -Force
      Write-Host "Removed previous installer download: $($oldFolder.Name)" -ForegroundColor DarkGray
    } catch {
      Write-Warning "The new installer is ready, but previous folder '$($oldFolder.Name)' is still in use and could not be removed."
    }
  }

  Write-Host ''
  Write-Host "Installer source: $sourceLabel" -ForegroundColor Green
  if ($installer.Source -eq 'CI') {
    Write-Host "CI commit: $($installer.HeadSha)"
    Write-Host "CI run: $($installer.RunUrl)"
  } else {
    Write-Host "Local branch: $($installer.Branch); commit: $($installer.HeadSha)"
    if ($installer.WorkingTreeDirty) {
      Write-Host 'Included uncommitted local changes.' -ForegroundColor Yellow
    }
  }
  Write-Host "Files: $finalDirectory" -ForegroundColor Green
  Write-Host "EXE:   $([System.IO.Path]::Combine($finalDirectory, $exeName))"
  Write-Host "MSI:   $([System.IO.Path]::Combine($finalDirectory, $msiName))"
  Write-Host "Guide: $([System.IO.Path]::Combine($finalDirectory, 'INSTALL.txt'))"
  Write-Host ''
  Write-Host 'Start the compatible local backend with: .\scripts\start.ps1' -ForegroundColor Cyan

  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $finalDirectory + '"')
    Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + [System.IO.Path]::Combine($finalDirectory, 'INSTALL.txt') + '"')
  } catch {
    Write-Warning 'Could not open the installer folder or guide automatically. Open INSTALL.txt from the output folder.'
  }
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $workDirectory) {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
    Write-Warning "A backup folder remains and was not deleted: $backupDirectory"
  }
}
