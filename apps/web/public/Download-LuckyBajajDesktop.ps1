[CmdletBinding()]
param(
  [string]$DownloadRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\LuckyBajajDesktopLocalDocker')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = 'Manav326/BajajDealership'
$branch = 'feature/dealership-licensing-readonly'
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
  if (-not [string]::IsNullOrWhiteSpace($token)) {
    $headers.Authorization = "Bearer $token"
  }
  return $headers
}

function Invoke-GitHubApi {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    return Invoke-RestMethod -Uri "$apiRoot/$Path" -Headers $script:githubHeaders -Method Get
  } catch {
    $message = $_.Exception.Message
    if ($message -match '401|403|rate limit') {
      throw "GitHub denied access to the Actions artifact API. For this public-repository download, retry later; if access still requires authentication, sign in with GitHub CLI or set GH_TOKEN to a fine-grained token with Actions: read access. Details: $message"
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
  Write-Host 'Checking the current PR #37 Windows build…' -ForegroundColor Cyan

  $branchRef = Invoke-GitHubApi -Path 'git/ref/heads/feature/dealership-licensing-readonly'
  $headSha = $branchRef.object.sha
  if ([string]::IsNullOrWhiteSpace($headSha)) { throw 'GitHub did not return the current PR branch commit.' }

  $encodedBranch = [Uri]::EscapeDataString($branch)
  $runResponse = Invoke-GitHubApi -Path "actions/runs?branch=$encodedBranch&event=pull_request&per_page=100"
  $matchingRuns = @($runResponse.workflow_runs | Where-Object { $_.head_sha -eq $headSha })
  if ($matchingRuns.Count -eq 0) {
    throw "Windows CI has not produced a run for the current PR commit ($headSha). Wait for CI to finish for PR #37, then run this downloader again. An older build will not be substituted."
  }
  $run = $matchingRuns | Sort-Object { [DateTime]$_.created_at } -Descending | Select-Object -First 1

  $jobsResponse = Invoke-GitHubApi -Path "actions/runs/$($run.id)/jobs?per_page=100"
  $desktopJob = @($jobsResponse.jobs | Where-Object { $_.name -eq $desktopJobName } | Select-Object -First 1)
  if ($desktopJob.Count -eq 0) { throw 'The current PR workflow has no Windows desktop build job.' }
  if ($desktopJob[0].status -ne 'completed' -or $desktopJob[0].conclusion -ne 'success') {
    throw "The Windows desktop build for the current PR commit is not successful yet (status: $($desktopJob[0].status), result: $($desktopJob[0].conclusion)). No installer was downloaded."
  }

  $artifactsResponse = Invoke-GitHubApi -Path "actions/runs/$($run.id)/artifacts?per_page=100"
  $artifact = @($artifactsResponse.artifacts | Where-Object {
    $_.name.StartsWith($artifactPrefix, [StringComparison]::OrdinalIgnoreCase) -and -not $_.expired
  } | Select-Object -First 1)
  if ($artifact.Count -eq 0) {
    throw 'The current successful Windows job does not contain a downloadable local-Docker installer artifact. No older artifact was substituted.'
  }

  $archivePath = Join-Path $stagingDirectory 'windows-local-docker-artifact.zip'
  $artifactUrl = "$apiRoot/actions/artifacts/$($artifact[0].id)/zip"
  try {
    Invoke-WebRequest -Uri $artifactUrl -Headers $script:githubHeaders -OutFile $archivePath -MaximumRedirection 10 -UseBasicParsing
  } catch {
    throw "The Windows artifact could not be downloaded. Sign in with GitHub CLI or set GH_TOKEN with Actions: read access if this repository requires authentication. Details: $($_.Exception.Message)"
  }

  if ($artifact[0].size_in_bytes -and (Get-Item -LiteralPath $archivePath).Length -ne [long]$artifact[0].size_in_bytes) {
    throw 'The downloaded artifact size does not match GitHub’s artifact metadata.'
  }
  if ($artifact[0].digest -notmatch '^sha256:(?<hash>[A-Fa-f0-9]{64})

  $extractDirectory = Join-Path $stagingDirectory 'extracted'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
  $exeFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.exe' -File -Recurse)
  $msiFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.msi' -File -Recurse)
  if ($exeFiles.Count -ne 1 -or $msiFiles.Count -ne 1) {
    throw "Expected exactly one EXE and one MSI in the Windows artifact; found $($exeFiles.Count) EXE and $($msiFiles.Count) MSI files."
  }

  $shortSha = $headSha.Substring(0, 12).ToLowerInvariant()
  $versionDirectoryName = "LuckyBajajDesktop-LocalDocker-$shortSha"
  $finalDirectory = Join-Path $resolvedRoot $versionDirectoryName
  $exePath = Join-Path $stagingDirectory $exeFiles[0].Name
  $msiPath = Join-Path $stagingDirectory $msiFiles[0].Name
  Copy-Item -LiteralPath $exeFiles[0].FullName -Destination $exePath
  Copy-Item -LiteralPath $msiFiles[0].FullName -Destination $msiPath
  $exeHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $msiHash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $runUrl = $run.html_url
  $installGuide = @"
LUCKY BAJAJ DESKTOP — LOCAL DOCKER TEST INSTALLATION
PR branch: $branch
Source commit: $headSha
Windows CI run: $runUrl
GitHub artifact: $($artifact[0].name)
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
   git pull
3. Build the API from this branch:
   docker compose build api
4. Start the API and its dependencies without rebuilding again:
   docker compose up -d --no-build api
5. Confirm the local API is healthy:
   Invoke-RestMethod http://127.0.0.1:8080/actuator/health
   The response must report status UP before you continue.

Do not use the current main/GHCR latest API for this PR build yet. PR #37 contains the required Tauri CORS/device support and Flyway migrations V46/V47. Do not delete your existing PostgreSQL Docker volume.

STEP 2 — Install the desktop app
1. Close Lucky Bajaj Desktop if it is already open.
2. Choose ONE installer from this folder; do not run both:
   EXE: $($exeFiles[0].Name) — guided setup.
   MSI: $($msiFiles[0].Name) — Windows Installer.
3. Double-click the chosen file and follow the setup wizard.
4. Open Lucky Bajaj Desktop from the Windows Start menu.
5. Sign in with your existing Lucky Bajaj staff account.

SECURITY AND UPDATE NOTES
- These direct-download EXE/MSI packages are intentionally unsigned. Windows may show Unknown Publisher or SmartScreen warnings. Do not disable Windows security protections; if policy blocks installation, stop and request an approved signed build.
- Extracted EXE SHA-256: $exeHash
- Extracted MSI SHA-256: $msiHash
- A newer run of this helper replaces older local-test download folders only after the latest branch artifact is downloaded and both installers are validated.
- This cleanup affects only this helper's version folders under the dedicated download location. It does not uninstall the app, modify Docker data, or remove unrelated files.
"@
  [System.IO.File]::WriteAllText((Join-Path $stagingDirectory 'INSTALL.txt'), $installGuide, [System.Text.UTF8Encoding]::new($false))
  $buildInfo = "Commit: $headSha" + [Environment]::NewLine + "Run: $runUrl" + [Environment]::NewLine + "Artifact: $($artifact[0].name)" + [Environment]::NewLine + "Artifact SHA-256: $archiveHash" + [Environment]::NewLine
  [System.IO.File]::WriteAllText((Join-Path $stagingDirectory 'BUILD-INFO.txt'), $buildInfo, [System.Text.UTF8Encoding]::new($false))

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
      Write-Warning "The latest build is ready, but the previous folder '$($oldFolder.Name)' is still in use and could not be removed."
    }
  }

  Write-Host ''
  Write-Host "Latest local-Docker build downloaded: $shortSha" -ForegroundColor Green
  Write-Host "Files: $finalDirectory"
  Write-Host ''
  Write-Host 'BEFORE INSTALLING — start the compatible API in your repo folder:' -ForegroundColor Cyan
  Write-Host "  git switch $branch"
  Write-Host '  docker compose build api'
  Write-Host '  docker compose up -d --no-build api'
  Write-Host '  Invoke-RestMethod http://127.0.0.1:8080/actuator/health'
  Write-Host ''
  Write-Host 'INSTALL — choose ONE file, not both:' -ForegroundColor Cyan
  Write-Host "  EXE: $([System.IO.Path]::Combine($finalDirectory, $exeFiles[0].Name))"
  Write-Host "  MSI: $([System.IO.Path]::Combine($finalDirectory, $msiFiles[0].Name))"
  Write-Host 'Double-click the chosen installer, complete setup, then launch Lucky Bajaj Desktop from the Start menu.'
  Write-Host 'This build targets 127.0.0.1:8080 and is for this computer only. Do not distribute it to customers.'
  Write-Host "Full instructions: $([System.IO.Path]::Combine($finalDirectory, 'INSTALL.txt'))"
  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $finalDirectory + '"')
  } catch {
    Write-Warning 'Could not open File Explorer automatically. Open the folder path shown above.'
  }
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
    Write-Warning "A backup folder remains and was not deleted: $backupDirectory"
  }
}
) {
    throw 'GitHub did not provide a SHA-256 digest for this Actions artifact. No installer was downloaded.'
  }
  $expectedArchiveHash = $Matches.hash.ToLowerInvariant()
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($archiveHash -ne $expectedArchiveHash) {
    throw 'The downloaded Actions artifact failed its SHA-256 digest check.'
  }

  $extractDirectory = Join-Path $stagingDirectory 'extracted'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
  $exeFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.exe' -File -Recurse)
  $msiFiles = @(Get-ChildItem -LiteralPath $extractDirectory -Filter '*.msi' -File -Recurse)
  if ($exeFiles.Count -ne 1 -or $msiFiles.Count -ne 1) {
    throw "Expected exactly one EXE and one MSI in the Windows artifact; found $($exeFiles.Count) EXE and $($msiFiles.Count) MSI files."
  }

  $shortSha = $headSha.Substring(0, 12).ToLowerInvariant()
  $versionDirectoryName = "LuckyBajajDesktop-LocalDocker-$shortSha"
  $finalDirectory = Join-Path $resolvedRoot $versionDirectoryName
  $exePath = Join-Path $stagingDirectory $exeFiles[0].Name
  $msiPath = Join-Path $stagingDirectory $msiFiles[0].Name
  Copy-Item -LiteralPath $exeFiles[0].FullName -Destination $exePath
  Copy-Item -LiteralPath $msiFiles[0].FullName -Destination $msiPath
  $exeHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $msiHash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()

  $runUrl = $run.html_url
  $installGuide = @"
LUCKY BAJAJ DESKTOP — LOCAL DOCKER TEST INSTALLATION
PR branch: $branch
Source commit: $headSha
Windows CI run: $runUrl
GitHub artifact: $($artifact[0].name)
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
   git pull
3. Build the API from this branch:
   docker compose build api
4. Start the API and its dependencies without rebuilding again:
   docker compose up -d --no-build api
5. Confirm the local API is healthy:
   Invoke-RestMethod http://127.0.0.1:8080/actuator/health
   The response must report status UP before you continue.

Do not use the current main/GHCR latest API for this PR build yet. PR #37 contains the required Tauri CORS/device support and Flyway migrations V46/V47. Do not delete your existing PostgreSQL Docker volume.

STEP 2 — Install the desktop app
1. Close Lucky Bajaj Desktop if it is already open.
2. Choose ONE installer from this folder; do not run both:
   EXE: $($exeFiles[0].Name) — guided setup.
   MSI: $($msiFiles[0].Name) — Windows Installer.
3. Double-click the chosen file and follow the setup wizard.
4. Open Lucky Bajaj Desktop from the Windows Start menu.
5. Sign in with your existing Lucky Bajaj staff account.

SECURITY AND UPDATE NOTES
- These direct-download EXE/MSI packages are intentionally unsigned. Windows may show Unknown Publisher or SmartScreen warnings. Do not disable Windows security protections; if policy blocks installation, stop and request an approved signed build.
- Extracted EXE SHA-256: $exeHash
- Extracted MSI SHA-256: $msiHash
- A newer run of this helper replaces older local-test download folders only after the latest branch artifact is downloaded and both installers are validated.
- This cleanup affects only this helper's version folders under the dedicated download location. It does not uninstall the app, modify Docker data, or remove unrelated files.
"@
  [System.IO.File]::WriteAllText((Join-Path $stagingDirectory 'INSTALL.txt'), $installGuide, [System.Text.UTF8Encoding]::new($false))
  $buildInfo = "Commit: $headSha" + [Environment]::NewLine + "Run: $runUrl" + [Environment]::NewLine + "Artifact: $($artifact[0].name)" + [Environment]::NewLine + "Artifact SHA-256: $archiveHash" + [Environment]::NewLine
  [System.IO.File]::WriteAllText((Join-Path $stagingDirectory 'BUILD-INFO.txt'), $buildInfo, [System.Text.UTF8Encoding]::new($false))

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
      Write-Warning "The latest build is ready, but the previous folder '$($oldFolder.Name)' is still in use and could not be removed."
    }
  }

  Write-Host ''
  Write-Host "Latest local-Docker build downloaded: $shortSha" -ForegroundColor Green
  Write-Host "Files: $finalDirectory"
  Write-Host ''
  Write-Host 'BEFORE INSTALLING — start the compatible API in your repo folder:' -ForegroundColor Cyan
  Write-Host "  git switch $branch"
  Write-Host '  docker compose build api'
  Write-Host '  docker compose up -d --no-build api'
  Write-Host '  Invoke-RestMethod http://127.0.0.1:8080/actuator/health'
  Write-Host ''
  Write-Host 'INSTALL — choose ONE file, not both:' -ForegroundColor Cyan
  Write-Host "  EXE: $([System.IO.Path]::Combine($finalDirectory, $exeFiles[0].Name))"
  Write-Host "  MSI: $([System.IO.Path]::Combine($finalDirectory, $msiFiles[0].Name))"
  Write-Host 'Double-click the chosen installer, complete setup, then launch Lucky Bajaj Desktop from the Start menu.'
  Write-Host 'This build targets 127.0.0.1:8080 and is for this computer only. Do not distribute it to customers.'
  Write-Host "Full instructions: $([System.IO.Path]::Combine($finalDirectory, 'INSTALL.txt'))"
  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $finalDirectory + '"')
  } catch {
    Write-Warning 'Could not open File Explorer automatically. Open the folder path shown above.'
  }
} finally {
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($backupDirectory -and (Test-Path -LiteralPath $backupDirectory)) {
    Write-Warning "A backup folder remains and was not deleted: $backupDirectory"
  }
}
