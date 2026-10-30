[CmdletBinding()]
param(
  [string]$DownloadRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\LuckyBajajDesktopLocalDocker')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = 'Manav326/BajajDealership'
$branch = $null
$apiRoot = "https://api.github.com/repos/$repository"
$artifactPrefix = 'lucky-bajaj-windows-local-docker-'
$desktopJobName = 'Build unsigned direct installers and Store MSIX package'

function Get-GitHubHeaders {
  $headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'LuckyBajajDesktop-LocalDocker-Downloader'
    'X-GitHub-Api-Version' = '2022-11-28'
  }

  $token = $env:GH_TOKEN
  if ([string]::IsNullOrWhiteSpace($token)) { $token = $env:GITHUB_TOKEN }
  if ([string]::IsNullOrWhiteSpace($token)) {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
      $token = (& gh auth token 2>$null | Select-Object -First 1)
      if ($token) { $token = $token.Trim() }
    }
  }
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "GitHub Actions artifacts require an authenticated download. Install GitHub CLI with 'winget install --id GitHub.cli --exact', run 'gh auth login --hostname github.com --web', then rerun this script. Alternatively set GH_TOKEN or GITHUB_TOKEN with Actions: read permission."
  }
  $headers.Authorization = "Bearer $token"
  return $headers
}

function Invoke-GitHubApi {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    $uri = "$script:apiRoot/$Path"
    return Invoke-RestMethod -Uri $uri -Headers $script:githubHeaders -Method Get
  } catch {
    $message = $_.Exception.Message
    if ($message -match '401|403|rate limit') {
      throw "GitHub denied access to the Actions artifact API. Retry later or sign in with GitHub CLI / set GH_TOKEN with Actions read access. Details: $message"
    }
    throw "GitHub API request failed: $message"
  }
}

$script:githubHeaders = Get-GitHubHeaders
$resolvedRoot = [System.IO.Path]::GetFullPath($DownloadRoot)
$null = New-Item -ItemType Directory -Path $resolvedRoot -Force
$stagingName = '.LuckyBajajDesktopLocalDocker-staging-' + [Guid]::NewGuid().ToString('N')
$stagingDirectory = Join-Path $resolvedRoot $stagingName
$finalDirectory = $null
$backupDirectory = $null

try {
  $null = New-Item -ItemType Directory -Path $stagingDirectory -Force
  Write-Host 'Checking the latest PR #37 Windows build…' -ForegroundColor Cyan

  $pullRequest = Invoke-GitHubApi -Path 'pulls/37'
  if ($pullRequest.state -eq 'closed' -and -not $pullRequest.merged) {
    throw 'PR #37 was closed without merging. There is no supported current branch for this local-Docker test build.'
  }
  if ($pullRequest.merged -eq $true) {
    $branch = 'main'
    $backendCompatibilityNote = 'PR #37 has been merged. The main branch contains the required Tauri CORS/device support and V46/V47 migrations. Build the API from main, then verify its health before installing.'
  } else {
    $branch = 'feature/dealership-licensing-readonly'
    $backendCompatibilityNote = 'PR #37 is still open. Main/GHCR latest does not yet contain the Tauri CORS/device support or V46/V47 migrations. Build the API from the feature branch above and do not delete your existing PostgreSQL Docker volume.'
  }

  Write-Host "Checking the latest $branch Windows build…" -ForegroundColor Cyan
  $branchRef = Invoke-GitHubApi -Path "git/ref/heads/$branch"
  $headSha = $branchRef.object.sha
  if ([string]::IsNullOrWhiteSpace($headSha)) {
    throw 'GitHub did not return the current PR branch commit.'
  }

  $encodedBranch = [Uri]::EscapeDataString($branch)
  $runResponse = Invoke-GitHubApi -Path "actions/runs?branch=$encodedBranch&per_page=100"
  $matchingRuns = @(
    $runResponse.workflow_runs |
      Where-Object { $_.head_sha -eq $headSha -and $_.event -in @('push', 'workflow_dispatch') } |
      Sort-Object { [DateTime]$_.created_at } -Descending
  )
  if ($matchingRuns.Count -eq 0) {
    throw "Windows CI has not produced a push or manual run for the current source commit ($headSha). Run this downloader again only after the current-commit CI run appears. An older build will not be substituted."
  }
  $run = $matchingRuns[0]

  $jobsResponse = Invoke-GitHubApi -Path "actions/runs/$($run.id)/jobs?per_page=100"
  $desktopJob = @($jobsResponse.jobs | Where-Object { $_.name -eq $desktopJobName } | Select-Object -First 1)
  if ($desktopJob.Count -eq 0) {
    throw 'The current CI run has no Windows desktop build job.'
  }
  if ($desktopJob[0].status -ne 'completed' -or $desktopJob[0].conclusion -ne 'success') {
    throw "The Windows desktop build is not successful (status: $($desktopJob[0].status), result: $($desktopJob[0].conclusion)). No installer was downloaded."
  }

  $artifactName = "$artifactPrefix$headSha"
  $artifactsResponse = Invoke-GitHubApi -Path "actions/runs/$($run.id)/artifacts?per_page=100"
  $artifact = @($artifactsResponse.artifacts | Where-Object {
    $_.name -ceq $artifactName -and -not $_.expired
  } | Select-Object -First 1)
  if ($artifact.Count -eq 0) {
    throw "The successful Windows job did not publish the expected artifact '$artifactName'. No older artifact was substituted."
  }

  $archivePath = Join-Path $stagingDirectory 'windows-local-docker-artifact.zip'
  $artifactUrl = "$apiRoot/actions/artifacts/$($artifact[0].id)/zip"
  try {
    Invoke-WebRequest -Uri $artifactUrl -Headers $script:githubHeaders -OutFile $archivePath -MaximumRedirection 10 -UseBasicParsing
  } catch {
    throw "The Windows artifact could not be downloaded. Sign in with GitHub CLI or set GH_TOKEN with Actions read access if needed. Details: $($_.Exception.Message)"
  }

  if ($artifact[0].size_in_bytes -and (Get-Item -LiteralPath $archivePath).Length -ne [long]$artifact[0].size_in_bytes) {
    throw 'The downloaded artifact size does not match GitHub artifact metadata.'
  }
  if ($artifact[0].digest -notmatch '^sha256:([a-fA-F0-9]{64})$') {
    throw 'GitHub did not provide a SHA-256 digest for this Actions artifact. No installer was saved.'
  }
  $expectedArchiveHash = $Matches[1].ToLowerInvariant()
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $expectedArchiveHash) {
    throw 'The downloaded Actions artifact failed its SHA-256 digest check.'
  }

  $extractDirectory = Join-Path $stagingDirectory 'extracted'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
  $exeFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.exe' -File -Recurse)
  $msiFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.msi' -File -Recurse)
  if ($exeFiles.Count -ne 1 -or $msiFiles.Count -ne 1) {
    throw "Expected exactly one EXE and one MSI in the artifact; found $($exeFiles.Count) EXE and $($msiFiles.Count) MSI files."
  }

  $shortSha = $headSha.Substring(0, 12).ToLowerInvariant()
  $finalDirectory = Join-Path $resolvedRoot "LuckyBajajDesktop-LocalDocker-$shortSha"
  Copy-Item -LiteralPath $exeFiles[0].FullName -Destination (Join-Path $stagingDirectory $exeFiles[0].Name)
  Copy-Item -LiteralPath $msiFiles[0].FullName -Destination (Join-Path $stagingDirectory $msiFiles[0].Name)
  $exeHash = (Get-FileHash -LiteralPath (Join-Path $stagingDirectory $exeFiles[0].Name) -Algorithm SHA256).Hash.ToLowerInvariant()
  $msiHash = (Get-FileHash -LiteralPath (Join-Path $stagingDirectory $msiFiles[0].Name) -Algorithm SHA256).Hash.ToLowerInvariant()

  Remove-Item -LiteralPath $extractDirectory -Recurse -Force
  Remove-Item -LiteralPath $archivePath -Force

  $runUrl = $run.html_url
  $installGuide = @"
LUCKY BAJAJ DESKTOP — LOCAL DOCKER TEST INSTALLATION
PR branch: $branch
Source commit: $headSha
Windows CI run: $runUrl
GitHub artifact: $artifactName
Artifact SHA-256: $archiveHash

IMPORTANT:
This installer is compiled to call http://127.0.0.1:8080.
It is for testing on the SAME Windows computer where the Lucky Bajaj Docker API is running.
Do not give this local-Docker build to customers or install it on another computer.

STEP 1 — Start the compatible local backend
1. Open PowerShell in your local BajajDealership repository folder.
2. Check out the PR branch and update it:
   git fetch origin
   git switch $branch
   git pull origin $branch
3. Build the API from this branch:
   docker compose build api
4. Start the API and its dependencies:
   docker compose up -d --no-build api
5. Confirm the local API is healthy:
   Invoke-RestMethod http://127.0.0.1:8080/actuator/health
   Continue only when the response reports status UP.

$backendCompatibilityNote

STEP 2 — Install the desktop app
1. Close Lucky Bajaj Desktop if it is running.
2. Choose ONE installer from this folder; do not run both:
   EXE: $($exeFiles[0].Name) — guided setup.
   MSI: $($msiFiles[0].Name) — Windows Installer.
3. Double-click the chosen file and follow the setup wizard.
4. Open Lucky Bajaj Desktop from the Windows Start menu.
5. Sign in with your existing Lucky Bajaj staff account.

SECURITY AND UPDATE NOTES
- Direct-download EXE/MSI packages are intentionally unsigned and may show Unknown Publisher or SmartScreen warnings. Do not disable Windows security protections. If policy blocks installation, request an approved signed build.
- Extracted EXE SHA-256: $exeHash
- Extracted MSI SHA-256: $msiHash
- A later run of this helper removes older local-test download folders created by this helper, only after the newer artifact has passed validation.
- Keep using the same installer type (EXE or MSI) for later upgrades. The cleanup removes downloaded installer files only; it does not uninstall the app.
- This cleanup does not uninstall the app, modify Docker data, or remove unrelated files.
"@
  [System.IO.File]::WriteAllText(
    (Join-Path $stagingDirectory 'INSTALL.txt'),
    $installGuide,
    [System.Text.UTF8Encoding]::new($false)
  )
  $buildInfo = "Commit: $headSha" + [Environment]::NewLine +
    "Run: $runUrl" + [Environment]::NewLine +
    "Artifact: $artifactName" + [Environment]::NewLine +
    "Artifact SHA-256: $archiveHash" + [Environment]::NewLine
  [System.IO.File]::WriteAllText(
    (Join-Path $stagingDirectory 'BUILD-INFO.txt'),
    $buildInfo,
    [System.Text.UTF8Encoding]::new($false)
  )

  if (Test-Path -LiteralPath $finalDirectory) {
    $backupDirectory = Join-Path $resolvedRoot ('.LuckyBajajDesktopLocalDocker-backup-' + [Guid]::NewGuid().ToString('N'))
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
        $_.Name -match '^LuckyBajajDesktop-LocalDocker-[0-9a-f]{12}$' -and
        $_.FullName -ne $finalDirectory
      }
  )
  foreach ($oldFolder in $oldFolders) {
    try {
      Remove-Item -LiteralPath $oldFolder.FullName -Recurse -Force
      Write-Host "Removed previous local-test download: $($oldFolder.Name)" -ForegroundColor DarkGray
    } catch {
      Write-Warning "The newer build is ready, but previous folder '$($oldFolder.Name)' is still in use and could not be removed."
    }
  }

  Write-Host ''
  Write-Host "Latest local-Docker build downloaded: $shortSha" -ForegroundColor Green
  Write-Host "Files: $finalDirectory"
  Write-Host ''
  Write-Host 'BEFORE INSTALLING — run these commands in your repository folder:' -ForegroundColor Cyan
  Write-Host "  git switch $branch"
  Write-Host '  docker compose build api'
  Write-Host '  docker compose up -d --no-build api'
  Write-Host '  Invoke-RestMethod http://127.0.0.1:8080/actuator/health'
  Write-Host ''
  Write-Host 'INSTALL — choose ONE installer, not both:' -ForegroundColor Cyan
  Write-Host "  EXE: $([System.IO.Path]::Combine($finalDirectory, $exeFiles[0].Name))"
  Write-Host "  MSI: $([System.IO.Path]::Combine($finalDirectory, $msiFiles[0].Name))"
  Write-Host 'Double-click the chosen installer, complete setup, then launch Lucky Bajaj Desktop from the Start menu.'
  Write-Host 'This build targets 127.0.0.1:8080 and is for this computer only.'
  Write-Host "Full instructions: $([System.IO.Path]::Combine($finalDirectory, 'INSTALL.txt'))"
  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $finalDirectory + '"')
    Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + [System.IO.Path]::Combine($finalDirectory, 'INSTALL.txt') + '"')
  } catch {
    Write-Warning 'Could not open the instruction file automatically. Open INSTALL.txt in the downloaded folder.'
  }
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
    Write-Warning "A backup folder remains and was not deleted: $backupDirectory"
  }
}
