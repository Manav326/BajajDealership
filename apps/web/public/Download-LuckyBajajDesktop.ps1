[CmdletBinding()]
param(
  [string]$DownloadRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\LuckyBajajDesktop')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = 'Manav326/BajajDealership'
$releaseApi = "https://api.github.com/repos/$repository/releases?per_page=100"
$officialAssetPrefix = "https://github.com/$repository/releases/download/"
$installerNames = @('LuckyBajajDesktopSetup.exe', 'LuckyBajajDesktop.msi')
$checksumName = 'SHA256SUMS.txt'

function Get-ReleaseAsset {
  param(
    [Parameter(Mandatory = $true)]$Release,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $asset = @($Release.assets | Where-Object { $_.name -ceq $Name } | Select-Object -First 1)
  if ($asset.Count -eq 0) {
    throw "The selected release is missing required asset '$Name'."
  }
  if (-not $asset[0].browser_download_url.StartsWith($officialAssetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing an installer asset outside the official GitHub release location: $Name"
  }
  return $asset[0]
}

function Get-ExpectedSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$AssetName
  )
  $escapedName = [Regex]::Escape($AssetName)
  $match = [Regex]::Match(
    $Manifest,
    "(?im)^(?<hash>[a-f0-9]{64})\s+\*?$escapedName\s*$"
  )
  if (-not $match.Success) {
    throw "SHA-256 entry for '$AssetName' was not found in $checksumName."
  }
  return $match.Groups['hash'].Value.ToLowerInvariant()
}

function Save-VerifiedAsset {
  param(
    [Parameter(Mandatory = $true)]$Asset,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$ExpectedHash
  )
  Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Destination -MaximumRedirection 10 -UseBasicParsing
  $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $ExpectedHash) {
    throw "Checksum verification failed for $($Asset.name). The downloaded file will not replace older installers."
  }
  Write-Host "Verified SHA-256: $($Asset.name)" -ForegroundColor Green
}

$resolvedRoot = [System.IO.Path]::GetFullPath($DownloadRoot)
$null = New-Item -ItemType Directory -Path $resolvedRoot -Force
$stagingName = '.LuckyBajajDesktop-staging-' + [Guid]::NewGuid().ToString('N')
$stagingDirectory = Join-Path $resolvedRoot $stagingName
$finalDirectory = $null
$backupDirectory = $null

try {
  $null = New-Item -ItemType Directory -Path $stagingDirectory -Force
  Write-Host 'Checking the official Lucky Bajaj Desktop releases…' -ForegroundColor Cyan

  $headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'LuckyBajajDesktop-Official-Installer'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
  $releases = Invoke-RestMethod -Uri $releaseApi -Headers $headers -Method Get
  $stableReleases = @($releases | Where-Object {
    -not $_.draft -and
    -not $_.prerelease -and
    $_.tag_name -match '^desktop-v\d+\.\d+\.\d+$' -and
    $_.assets
  })

  if ($stableReleases.Count -eq 0) {
    throw 'No reviewed public desktop release is available yet. Keep using the staff website and try again after the official release is published.'
  }

  $release = $stableReleases |
    Sort-Object { [Version]($_.tag_name -replace '^desktop-v', '') } -Descending |
    Select-Object -First 1

  $exeAsset = Get-ReleaseAsset -Release $release -Name $installerNames[0]
  $msiAsset = Get-ReleaseAsset -Release $release -Name $installerNames[1]
  $checksumAsset = Get-ReleaseAsset -Release $release -Name $checksumName

  $checksumPath = Join-Path $stagingDirectory $checksumName
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath -MaximumRedirection 10 -UseBasicParsing
  $manifest = [System.IO.File]::ReadAllText($checksumPath, [System.Text.Encoding]::UTF8)

  foreach ($name in $installerNames) {
    $expected = Get-ExpectedSha256 -Manifest $manifest -AssetName $name
    $asset = if ($name -eq $installerNames[0]) { $exeAsset } else { $msiAsset }
    Save-VerifiedAsset -Asset $asset -Destination (Join-Path $stagingDirectory $name) -ExpectedHash $expected
  }

  $versionDirectoryName = 'LuckyBajajDesktop-' + $release.tag_name
  $finalDirectory = Join-Path $resolvedRoot $versionDirectoryName
  $installGuide = @"
LUCKY BAJAJ DESKTOP — INSTALLATION GUIDE
Release: $($release.tag_name)
Official release: $($release.html_url)

Downloaded files:
- $($installerNames[0])
- $($installerNames[1])
- $checksumName

INSTALL — choose ONE installer; do not run both:
1. Close Lucky Bajaj Desktop if it is already open.
2. For the guided setup, double-click $($installerNames[0]).
   OR use the Windows Installer package by double-clicking $($installerNames[1]).
3. Follow the setup wizard and accept the normal Windows installation prompts.
4. When setup completes, open "Lucky Bajaj Desktop" from the Windows Start menu.
5. Sign in with your existing Lucky Bajaj staff account. Your records remain on the central dealership system.

SECURITY:
- The direct-download EXE/MSI packages are intentionally unsigned and may show Unknown Publisher or SmartScreen warnings.
- These files were downloaded from the official Manav326/BajajDealership GitHub release and their SHA-256 values were checked against SHA256SUMS.txt.
- Do not disable Windows Defender, SmartScreen, or other security protections. If your device policy blocks unsigned software, ask your administrator for an approved signed package.
- The MSIX file is not part of this download and must not be installed directly; it is reserved for Microsoft Store submission.

UPDATE / CLEANUP:
- This downloader removes older version folders created by this downloader only after the new EXE and MSI have both downloaded and passed checksum verification.
- It does not uninstall or delete the currently installed application, personal files, or manually downloaded files outside this dedicated folder.
"@
  [System.IO.File]::WriteAllText(
    (Join-Path $stagingDirectory 'INSTALL.txt'),
    $installGuide,
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

  $oldVersionFolders = @(
    Get-ChildItem -LiteralPath $resolvedRoot -Directory |
      Where-Object {
        $_.Name -match '^LuckyBajajDesktop-desktop-v\d+\.\d+\.\d+$' -and
        $_.FullName -ne $finalDirectory
      }
  )
  foreach ($oldFolder in $oldVersionFolders) {
    try {
      Remove-Item -LiteralPath $oldFolder.FullName -Recurse -Force
      Write-Host "Removed previous managed download: $($oldFolder.Name)" -ForegroundColor DarkGray
    } catch {
      Write-Warning "The new download is ready, but the old folder '$($oldFolder.FullName)' could not be removed. Close files open in that folder and delete it manually."
    }
  }

  Write-Host ''
  Write-Host "Download complete: $($release.tag_name)" -ForegroundColor Green
  Write-Host "Files saved in: $finalDirectory"
  Write-Host ''
  Write-Host 'INSTALL — choose ONE installer, not both:' -ForegroundColor Cyan
  Write-Host "  EXE: $([System.IO.Path]::Combine($finalDirectory, $installerNames[0]))"
  Write-Host "  MSI: $([System.IO.Path]::Combine($finalDirectory, $installerNames[1]))"
  Write-Host '1. Close the desktop app if it is running.'
  Write-Host '2. Double-click either the EXE (guided setup) or MSI (Windows Installer).'
  Write-Host '3. Follow the setup wizard, then open Lucky Bajaj Desktop from the Start menu.'
  Write-Host '4. Sign in with your existing dealership staff account.'
  Write-Host 'Unsigned installers can show Unknown Publisher / SmartScreen warnings. The checksum was verified; do not disable Windows security protections.'
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
