[CmdletBinding()]
param(
  [string]$LanIp = "192.168.31.47",
  [string]$DeviceId,
  [ValidateSet("Public", "Authenticated", "Notifications", "All")]
  [string]$Suite = "Public",
  [switch]$SkipBuild,
  [switch]$BuildLocalApk,
  [switch]$AllowNonLocalApi,
  [switch]$SkipApiHealthCheck
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$appRoot = Join-Path $projectRoot "apps/android-liquid-glass"
$maestroRoot = Join-Path $appRoot ".maestro"
$localEnvFile = Join-Path $maestroRoot "local.env"
$localBuildApkPath = Join-Path $appRoot "android/app/build/outputs/apk/release/app-release.apk"
$ciApkPath = Join-Path $projectRoot "artifacts/lucky-bajaj-liquid-glass-latest.apk"
$useExistingLocalApk = $SkipBuild -and (Test-Path -LiteralPath $localBuildApkPath -PathType Leaf) -and -not $BuildLocalApk
$apkPath = if ($BuildLocalApk -or $useExistingLocalApk) { $localBuildApkPath } else { $ciApkPath }
$apkMetadataPath = "$apkPath.json"
$reportRoot = Join-Path $appRoot "maestro-results"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $reportRoot $timestamp
$script:AdbPath = $null

function Fail([string]$Message) {
  throw $Message
}

function Import-MaestroLocalEnvironment {
  if (-not (Test-Path $localEnvFile)) { return }
  foreach ($line in Get-Content $localEnvFile) {
    $value = $line.Trim()
    if (-not $value -or $value.StartsWith("#")) { continue }
    if ($value -notmatch "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$") {
      Fail "Invalid line in $localEnvFile. Use KEY=value with one variable per line."
    }
    $name = $Matches[1]
    $setting = $Matches[2].Trim()
    if (($setting.StartsWith('"') -and $setting.EndsWith('"')) -or ($setting.StartsWith("'") -and $setting.EndsWith("'"))) {
      $setting = $setting.Substring(1, $setting.Length - 2)
    }
    if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
      [Environment]::SetEnvironmentVariable($name, $setting, "Process")
    }
  }
}

function Resolve-AdbExecutable {
  # Match the Android SDK installation already used on this Windows machine.
  # Do not require platform-tools to be added to the user's PATH.
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Android/Sdk/platform-tools/adb.exe")
  }
  foreach ($sdkRoot in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
    if ($sdkRoot) { $candidates += (Join-Path $sdkRoot "platform-tools/adb.exe") }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $resolvedAdb = (Resolve-Path -LiteralPath $candidate).Path
      $resolvedSdkRoot = Split-Path -Parent (Split-Path -Parent $resolvedAdb)
      if (Test-Path -LiteralPath (Join-Path $resolvedSdkRoot "platform-tools/adb.exe") -PathType Leaf) {
        # ADB proves which SDK is installed. Export it so an optional local Gradle build
        # works even when ANDROID_HOME / ANDROID_SDK_ROOT were not configured manually.
        $env:ANDROID_HOME = $resolvedSdkRoot
        $env:ANDROID_SDK_ROOT = $resolvedSdkRoot
      }
      return $resolvedAdb
    }
  }

  $pathCommand = Get-Command adb -ErrorAction SilentlyContinue
  if ($pathCommand -and $pathCommand.Source) {
    $resolvedAdb = (Resolve-Path -LiteralPath $pathCommand.Source).Path
    $resolvedSdkRoot = Split-Path -Parent (Split-Path -Parent $resolvedAdb)
    if (Test-Path -LiteralPath (Join-Path $resolvedSdkRoot "platform-tools/adb.exe") -PathType Leaf) {
      $env:ANDROID_HOME = $resolvedSdkRoot
      $env:ANDROID_SDK_ROOT = $resolvedSdkRoot
    }
    return $resolvedAdb
  }

  Fail ("ADB was not found. Checked the existing Android SDK location '{0}', ANDROID_SDK_ROOT/ANDROID_HOME, and PATH. Install Android SDK platform-tools if missing." -f (Join-Path $env:LOCALAPPDATA "Android/Sdk/platform-tools/adb.exe"))
}

function Resolve-MaestroExecutable {
  # Respect an existing installation first, including the standard C:\maestro location.
  # The script invokes the resolved launcher directly, so no user/system PATH edit is needed.
  $candidates = @()
  $pathCommand = Get-Command maestro -ErrorAction SilentlyContinue
  if ($pathCommand) {
    $commandPath = $pathCommand.Source
    if (-not $commandPath) { $commandPath = $pathCommand.Path }
    if ($commandPath) { $candidates += $commandPath }
  }

  $installRoots = @()
  if ($env:MAESTRO_HOME) { $installRoots += $env:MAESTRO_HOME }
  if ($env:LOCALAPPDATA) {
    $installRoots += (Join-Path $env:LOCALAPPDATA "Maestro")
    $installRoots += (Join-Path $env:LOCALAPPDATA "BajajDealership/tools/maestro")
  }
  $installRoots += "C:\maestro"

  foreach ($root in ($installRoots | Where-Object { $_ } | Select-Object -Unique)) {
    $candidates += (Join-Path $root "bin/maestro.bat")
    $candidates += (Join-Path $root "bin/maestro.exe")
    $candidates += (Join-Path $root "maestro.bat")
    $candidates += (Join-Path $root "maestro.exe")

    # The previous bootstrap copied the release ZIP's top-level "maestro" folder
    # underneath this install root, resulting in:
    # %LOCALAPPDATA%\BajajDealership\tools\maestro\maestro\bin\maestro.bat
    # Search inside existing install roots before deciding to download again.
    if (Test-Path -LiteralPath $root -PathType Container) {
      $nestedLaunchers = @(
        Get-ChildItem -LiteralPath $root -Filter "maestro.bat" -File -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.Directory.Name -ieq "bin" }
      )
      foreach ($launcher in $nestedLaunchers) {
        $candidates += $launcher.FullName
      }
    }
  }

  foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $resolvedLauncher = (Resolve-Path -LiteralPath $candidate).Path
      Write-Host ("Using existing Maestro installation: {0}" -f $resolvedLauncher)
      return $resolvedLauncher
    }
  }

  if (-not $env:LOCALAPPDATA) {
    Fail "LOCALAPPDATA is unavailable; cannot install Maestro into a user-local tools directory."
  }

  # Bootstrap the official Windows release ZIP into a stable, user-local directory.
  # This is separate from the repository and does not modify global PATH.
  $installRoot = Join-Path $env:LOCALAPPDATA "BajajDealership/tools/maestro"
  $downloadId = [Guid]::NewGuid().ToString("N")
  $zipPath = Join-Path $env:TEMP ("maestro-cli-" + $downloadId + ".zip")
  $extractRoot = Join-Path $env:TEMP ("maestro-cli-extract-" + $downloadId)
  $releaseUri = "https://github.com/mobile-dev-inc/Maestro/releases/latest/download/maestro.zip"

  try {
    Write-Host "Maestro CLI was not found. Downloading the official Windows release..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $releaseUri -OutFile $zipPath -UseBasicParsing -TimeoutSec 180
    if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf) -or (Get-Item -LiteralPath $zipPath).Length -lt 1024) {
      Fail "The Maestro release download was empty or incomplete."
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $downloadedLauncher = Get-ChildItem -LiteralPath $extractRoot -Filter "maestro.bat" -File -Recurse |
      Where-Object { $_.Directory.Name -ieq "bin" } |
      Select-Object -First 1
    if (-not $downloadedLauncher) {
      Fail "The downloaded Maestro ZIP did not contain the expected Windows bin/maestro.bat launcher."
    }

    if (Test-Path -LiteralPath $installRoot) {
      Remove-Item -LiteralPath $installRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $extractRoot "*") -Destination $installRoot -Recurse -Force

    $installedLauncher = Get-ChildItem -LiteralPath $installRoot -Filter "maestro.bat" -File -Recurse |
      Where-Object { $_.Directory.Name -ieq "bin" } |
      Select-Object -First 1
    if (-not $installedLauncher) {
      Fail "Maestro CLI was extracted, but its Windows launcher could not be found under $installRoot."
    }

    Write-Host ("Maestro CLI installed locally at: {0}" -f $installedLauncher.FullName)
    return $installedLauncher.FullName
  } catch {
    Fail ("Could not install Maestro CLI from the official release ZIP. Check internet access and write permissions, then retry. Details: {0}" -f $_.Exception.Message)
  } finally {
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Get-PhysicalAndroidDevice {
  $lines = & $script:AdbPath devices
  if ($LASTEXITCODE -ne 0) { Fail "ADB could not enumerate devices. Check Android SDK platform-tools." }
  $connected = @($lines | Where-Object { $_ -match "^\S+\s+device(?:\s|$)" } | ForEach-Object { ($_ -split "\s+")[0] })
  if ($DeviceId) {
    if ($connected -notcontains $DeviceId) {
      Fail "ADB device '$DeviceId' is not in the device state 'device'. Run '& $script:AdbPath devices -l' and authorize USB debugging."
    }
    $selected = $DeviceId
  } else {
    if ($connected.Count -eq 0) {
      Fail "No authorized Android phone found. Connect the physical phone by USB, enable Developer options > USB debugging, accept its RSA prompt, then rerun."
    }
    if ($connected.Count -gt 1) {
      Fail "More than one ADB device is connected ($($connected -join ', ')). Rerun with -DeviceId <serial>."
    }
    $selected = $connected[0]
  }

  $isEmulator = (& $script:AdbPath -s $selected shell getprop ro.kernel.qemu).Trim()
  if ($LASTEXITCODE -ne 0) { Fail "Could not inspect Android device '$selected'." }
  if ($isEmulator -eq "1") {
    Fail "Device '$selected' is an emulator. This workflow is configured for your physical Android phone."
  }
  return $selected
}

function Require-Environment([string[]]$Names) {
  $missing = @($Names | Where-Object { -not [Environment]::GetEnvironmentVariable($_, "Process") })
  if ($missing.Count -gt 0) {
    Fail "Missing Maestro test data in $localEnvFile or the current PowerShell environment: $($missing -join ', '). Use the example file and a dedicated local test customer."
  }
}

Import-MaestroLocalEnvironment
if (-not $LanIp) { Fail "The QuantaEdge LAN address is required. Pass -LanIp or set it in the script parameter." }

$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedAddress) -or
    [System.Net.IPAddress]::IsLoopback($parsedAddress) -or $LanIp.StartsWith("169.254.")) {
  Fail "'$LanIp' is not a usable computer LAN IPv4 address."
}

$localApiBaseUrl = "http://{0}:8080/" -f $LanIp

$script:AdbPath = Resolve-AdbExecutable
Write-Host ("Using ADB: {0}" -f $script:AdbPath)
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Fail "Java 17 or newer is required by Maestro CLI."
}
$env:MAESTRO_CLI_NO_ANALYTICS = "1"
$env:MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED = "true"

$script:MaestroPath = Resolve-MaestroExecutable
Write-Host ("Using Maestro CLI: {0}" -f $script:MaestroPath)
$maestroVersion = & $script:MaestroPath --version
if ($LASTEXITCODE -ne 0) { Fail "Maestro CLI was found but could not start. Verify Java 17+ and the Maestro installation." }
if ($maestroVersion) { Write-Host ("Maestro version: {0}" -f ($maestroVersion -join " ")) }

$selectedDevice = Get-PhysicalAndroidDevice
Write-Host ("Physical Android device: {0}" -f $selectedDevice)

if ($BuildLocalApk -and $SkipBuild) {
  Fail "Use either -BuildLocalApk or -SkipBuild, not both. The default workflow downloads the CI APK."
}

if ($BuildLocalApk) {
  $apiBaseUrl = $localApiBaseUrl
  $env:EXPO_PUBLIC_API_BASE_URL = $apiBaseUrl
  $env:EXPO_PUBLIC_CUSTOMER_WEB_URL = "http://{0}:3000" -f $LanIp
  Write-Host ("Building a local APK with API URL: {0}" -f $apiBaseUrl)
  Write-Host "HTTP is intentional for same-LAN local testing; this private address must not be used for a public release build."
} else {
  if (-not $useExistingLocalApk) {
    Write-Host ([Environment]::NewLine + "Downloading the latest successful main-branch Android APK from GitHub Actions...")
    $downloadScript = Join-Path $projectRoot "scripts/android-lg-fetch-latest-apk.ps1"
    if (-not (Test-Path -LiteralPath $downloadScript -PathType Leaf)) {
      Fail "The GitHub APK downloader is missing: $downloadScript. Pull the latest main branch and retry."
    }
    & $downloadScript -DownloadOnly
    if (-not $?) { Fail "GitHub APK download failed. Confirm GitHub CLI is installed and authenticated with 'gh auth login'." }
  } else {
    Write-Warning "Using the existing local Gradle APK because -SkipBuild was requested. Prefer the GitHub CI artifact for repeatable tests."
  }
  if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) {
    Fail "The APK was not found at $apkPath."
  }

  if (Test-Path -LiteralPath $apkMetadataPath -PathType Leaf) {
    try {
      $apkMetadata = Get-Content -LiteralPath $apkMetadataPath -Raw | ConvertFrom-Json
    } catch {
      Fail ("Could not read APK build metadata at {0}: {1}" -f $apkMetadataPath, $_.Exception.Message)
    }
    $apiBaseUrl = [string]$apkMetadata.apiBaseUrl
  } elseif ($useExistingLocalApk) {
    $apiBaseUrl = $localApiBaseUrl
    Write-Warning "This older local APK has no API metadata; the runner is assuming it was built with the current -LanIp value."
  } else {
    Fail "The downloaded APK has no build metadata. Pull an artifact from a successful CI run created after the Android build-metadata change; the runner will not guess which API the APK targets."
  }
  if ([string]::IsNullOrWhiteSpace($apiBaseUrl)) {
    Fail "The APK metadata does not record apiBaseUrl. Re-run after a successful CI Android build."
  }
  if ($apkMetadata.buildType -ne "release") {
    Fail "The selected APK is not a self-contained release-variant Maestro build. Debug APKs require Metro on port 8081."
  }

  if ($apkMetadata.packageName -and $apkMetadata.packageName -ne "com.quantaedge.luckybajajlg") {
    Fail ("The downloaded APK metadata describes package '{0}', not the Liquid Glass Edition package 'com.quantaedge.luckybajajlg'." -f $apkMetadata.packageName)
  }

  $expectedLocalApi = $localApiBaseUrl.TrimEnd("/")
  $embeddedApi = $apiBaseUrl.TrimEnd("/")
  if ($embeddedApi -ne $expectedLocalApi -and -not $AllowNonLocalApi) {
    Fail ("This CI APK is compiled for '{0}', not your local API '{1}'. -LanIp does not rewrite a prebuilt APK. Set the GitHub Actions repository variable BAJAJ_API_BASE_URL to '{1}', wait for a successful Android CI build, then rerun. Use -AllowNonLocalApi only when you intentionally want Maestro to test the API embedded in this APK." -f $apiBaseUrl, $localApiBaseUrl)
  }
  if ($embeddedApi -ne $expectedLocalApi) {
    Write-Warning ("Explicit non-local API test enabled. Maestro will use the API embedded in the APK: {0}" -f $apiBaseUrl)
  } else {
    Write-Host ("CI APK is configured for the local API: {0}" -f $apiBaseUrl)
  }
  if ($apkMetadata.headSha) {
    Write-Host ("APK source commit: {0}" -f $apkMetadata.headSha)
  }
}

if (-not $SkipApiHealthCheck) {
  if ([string]::IsNullOrWhiteSpace($apiBaseUrl)) {
    Fail "The APK API URL is unknown. The API health check cannot run safely."
  }
  $healthUrl = $apiBaseUrl.TrimEnd("/") + "/actuator/health"
  try {
    $health = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 8
    if ($health.status -and $health.status -ne "UP") { Fail "API health is '$($health.status)' at $healthUrl." }
    Write-Host ("API reachable at {0}" -f $healthUrl)
  } catch {
    Fail ("Cannot reach the API embedded in this APK at {0}. For local testing, start the local Docker/API stack, confirm port 8080 is published, allow inbound TCP 8080 on the Windows Private firewall profile, and ensure the phone is on the same LAN. {1}" -f $healthUrl, $_.Exception.Message)
  }
}

if ($BuildLocalApk) {
  Push-Location $appRoot
  try {
    Write-Host ([Environment]::NewLine + "Installing Android app dependencies...")
    & npm install --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

    Write-Host ([Environment]::NewLine + "Checking Expo dependency compatibility...")
    & npx expo install --check
    if ($LASTEXITCODE -ne 0) { Fail "Expo dependency check failed." }

    Write-Host ([Environment]::NewLine + "Typechecking the customer app...")
    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { Fail "Android TypeScript typecheck failed." }

    Write-Host ([Environment]::NewLine + "Generating the Android native project with local HTTP API configuration...")
    $previousCi = $env:CI
    try {
      $env:CI = "1"
      & npx expo prebuild --platform android --no-install
      if ($LASTEXITCODE -ne 0) { Fail "Expo Android prebuild failed." }
    } finally {
      if ($null -eq $previousCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue }
      else { $env:CI = $previousCi }
    }

    $androidProjectRoot = Join-Path $appRoot "android"
    $sdkRoot = $env:ANDROID_SDK_ROOT
    if (-not $sdkRoot -or -not (Test-Path -LiteralPath $sdkRoot -PathType Container)) {
      Fail "Android SDK was found through ADB, but its SDK root could not be resolved. Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK directory."
    }
    $localPropertiesPath = Join-Path $androidProjectRoot "local.properties"
    $sdkDirForGradle = $sdkRoot.Replace("\", "/")
    Set-Content -LiteralPath $localPropertiesPath -Value ("sdk.dir={0}" -f $sdkDirForGradle) -Encoding Ascii

    Push-Location $androidProjectRoot
    try {
      Write-Host ([Environment]::NewLine + "Building self-contained release-variant Maestro APK...")
      & .\gradlew.bat assembleRelease --no-daemon --build-cache --parallel
      if ($LASTEXITCODE -ne 0) { Fail "Self-contained Android Maestro APK build failed." }
    } finally {
      Pop-Location
    }
  } finally {
    Pop-Location
  }

  $localMetadata = [ordered]@{
    packageName = "com.quantaedge.luckybajajlg"
    apiBaseUrl = $apiBaseUrl
    headSha = "local"
    buildSource = "local"
    buildType = "release"
  }
  $localMetadata | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $apkMetadataPath -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) {
  Fail "Android APK was not found: $apkPath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkArchive = [System.IO.Compression.ZipFile]::OpenRead($apkPath)
try {
  $bundleEntry = $apkArchive.GetEntry("assets/index.android.bundle")
  if (-not $bundleEntry -or $bundleEntry.Length -le 0) {
    Fail "The APK is missing its embedded JavaScript bundle (assets/index.android.bundle). It would require Metro on port 8081."
  }
} finally {
  $apkArchive.Dispose()
}

Write-Host ([Environment]::NewLine + "Installing APK on the selected physical phone...")
& $script:AdbPath -s $selectedDevice install -r $apkPath
if ($LASTEXITCODE -ne 0) { Fail "APK installation failed. Check the phone for an existing incompatible or differently signed installation." }

$suites = switch ($Suite) {
  "Public" { @("public") }
  "Authenticated" { @("authenticated") }
  "Notifications" { @("authenticated", "fixtures") }
  "All" { @("public", "authenticated", "fixtures") }
}
if ($suites -contains "authenticated" -or $suites -contains "fixtures") {
  Require-Environment @("MAESTRO_DEALERSHIP_CODE", "MAESTRO_CUSTOMER_CODE", "MAESTRO_CUSTOMER_PASSWORD", "MAESTRO_CUSTOMER_VEHICLE_NAME")
}
if ($suites -contains "fixtures") {
  Require-Environment @(
    "MAESTRO_NOTIFICATION_TITLE",
    "MAESTRO_NOTIFICATION_IMAGE_ALT",
    "MAESTRO_NOTIFICATION_CTA_LABEL",
    "MAESTRO_NOTIFICATION_DESTINATION_HEADING",
    "MAESTRO_NOTIFICATION_ACTION_TITLE",
    "MAESTRO_NOTIFICATION_PAGE_TWO_TITLE",
    "MAESTRO_NOTIFICATION_UNSAFE_TARGET_TITLE",
    "MAESTRO_UNSAFE_CTA_LABEL"
  )
}

New-Item -ItemType Directory -Path $runRoot -Force | Out-Null

# Maestro validates flow YAML as part of each 'maestro test' invocation.
$maestroEnv = @()
foreach ($name in @(
  "MAESTRO_DEALERSHIP_CODE", "MAESTRO_CUSTOMER_CODE", "MAESTRO_CUSTOMER_PASSWORD", "MAESTRO_CUSTOMER_VEHICLE_NAME",
  "MAESTRO_NOTIFICATION_TITLE", "MAESTRO_NOTIFICATION_IMAGE_ALT", "MAESTRO_NOTIFICATION_CTA_LABEL",
  "MAESTRO_NOTIFICATION_DESTINATION_HEADING", "MAESTRO_NOTIFICATION_ACTION_TITLE",
  "MAESTRO_NOTIFICATION_PAGE_TWO_TITLE", "MAESTRO_NOTIFICATION_UNSAFE_TARGET_TITLE", "MAESTRO_UNSAFE_CTA_LABEL"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if ($value) { $maestroEnv += @("-e", "$name=$value") }
}

foreach ($suiteName in $suites) {
  $flowPath = Join-Path $maestroRoot "flows/$suiteName"
  $reportPath = Join-Path $runRoot "$suiteName.junit.xml"
  $debugPath = Join-Path $runRoot "$suiteName"
  New-Item -ItemType Directory -Path $debugPath -Force | Out-Null

  Write-Host ([Environment]::NewLine + "=== Maestro suite: $suiteName ===")
  $arguments = @("--device=$selectedDevice", "test", $flowPath, "--format", "JUNIT", "--output", $reportPath, "--test-output-dir", $debugPath) + $maestroEnv
  & $script:MaestroPath @arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "Maestro suite '$suiteName' failed. Review device output and the saved test artifacts."
  }
}

Write-Host ([Environment]::NewLine + "Maestro run completed successfully.")
Write-Host ("Device: {0}" -f $selectedDevice)
Write-Host ("API: {0}" -f $apiBaseUrl)
Write-Host ("Reports and screenshots: {0}" -f $runRoot)
