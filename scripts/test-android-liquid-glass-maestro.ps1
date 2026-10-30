[CmdletBinding()]
param(
  [string]$LanIp = "192.168.31.47",
  [string]$DeviceId,
  [ValidateSet("Public", "Authenticated", "Notifications", "All")]
  [string]$Suite = "Public",
  [switch]$SkipBuild,
  [switch]$SkipApiHealthCheck
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$appRoot = Join-Path $projectRoot "apps/android-liquid-glass"
$maestroRoot = Join-Path $appRoot ".maestro"
$localEnvFile = Join-Path $maestroRoot "local.env"
$apkPath = Join-Path $appRoot "android/app/build/outputs/apk/debug/app-debug.apk"
$reportRoot = Join-Path $appRoot "maestro-results"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $reportRoot $timestamp

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

function Get-PhysicalAndroidDevice {
  $lines = & adb devices
  if ($LASTEXITCODE -ne 0) { Fail "ADB could not enumerate devices. Check Android SDK platform-tools and PATH." }
  $connected = @($lines | Where-Object { $_ -match "^\S+\s+device(?:\s|$)" } | ForEach-Object { ($_ -split "\s+")[0] })
  if ($DeviceId) {
    if ($connected -notcontains $DeviceId) {
      Fail "ADB device '$DeviceId' is not in the device state 'device'. Run 'adb devices -l' and authorize USB debugging."
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

  $isEmulator = (& adb -s $selected shell getprop ro.kernel.qemu).Trim()
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

$apiBaseUrl = "http://{0}:8080/" -f $LanIp
$env:EXPO_PUBLIC_API_BASE_URL = $apiBaseUrl
$env:EXPO_PUBLIC_CUSTOMER_WEB_URL = "http://{0}:3000" -f $LanIp

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  Fail "ADB is not installed or not on PATH. Install Android SDK platform-tools and restart PowerShell."
}
if (-not (Get-Command maestro -ErrorAction SilentlyContinue)) {
  Fail "Maestro CLI is not installed or not on PATH. On Windows, download the CLI ZIP from https://github.com/mobile-dev-inc/Maestro/releases/latest, add its bin directory to PATH, and restart PowerShell."
}
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Fail "Java 17 or newer is required by Maestro and the Android Gradle build."
}

$selectedDevice = Get-PhysicalAndroidDevice
Write-Host ("Physical Android device: {0}" -f $selectedDevice)
Write-Host ("Local API compiled into app: {0}" -f $apiBaseUrl)
Write-Host "HTTP is intentional for same-LAN local testing; this private address must not be used for a public release build."

if (-not $SkipApiHealthCheck) {
  $healthUrl = $apiBaseUrl.TrimEnd("/") + "/actuator/health"
  try {
    $health = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 8
    if ($health.status -and $health.status -ne "UP") { Fail "Local API health is '$($health.status)' at $healthUrl." }
    Write-Host ("Local API reachable at {0}" -f $healthUrl)
  } catch {
    Fail ("Cannot reach local API at {0}. Start the local Docker/API stack, confirm port 8080 is published, allow inbound TCP 8080 on the Windows Private firewall profile, and ensure the phone is on the same LAN. {1}" -f $healthUrl, $_.Exception.Message)
  }
}

if (-not $SkipBuild) {
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
    & npx expo prebuild --platform android --non-interactive --no-install
    if ($LASTEXITCODE -ne 0) { Fail "Expo Android prebuild failed." }

    Push-Location (Join-Path $appRoot "android")
    try {
      Write-Host ([Environment]::NewLine + "Building installable debug APK...")
      & .\gradlew.bat assembleDebug --no-daemon --build-cache --parallel
      if ($LASTEXITCODE -ne 0) { Fail "Android debug APK build failed." }
    } finally {
      Pop-Location
    }
  } finally {
    Pop-Location
  }
} elseif (-not (Test-Path $apkPath)) {
  Fail "No debug APK exists at $apkPath. Run without -SkipBuild."
}

if (-not (Test-Path $apkPath)) { Fail "Android APK was not produced: $apkPath" }
Write-Host ([Environment]::NewLine + "Installing APK on the selected physical phone...")
& adb -s $selectedDevice install -r $apkPath
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
  & maestro @arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "Maestro suite '$suiteName' failed. Review device output and the saved test artifacts."
  }
}

Write-Host ([Environment]::NewLine + "Maestro run completed successfully.")
Write-Host ("Device: {0}" -f $selectedDevice)
Write-Host ("API: {0}" -f $apiBaseUrl)
Write-Host ("Reports and screenshots: {0}" -f $runRoot)
