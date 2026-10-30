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
$appRoot = Join-Path $projectRoot "apps/android"
$maestroRoot = Join-Path $appRoot ".maestro"
$localEnvFile = Join-Path $maestroRoot "local.env"
$apkPath = Join-Path $appRoot "android/app/build/outputs/apk/debug/app-debug.apk"
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
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $pathCommand = Get-Command adb -ErrorAction SilentlyContinue
  if ($pathCommand -and $pathCommand.Source) { return $pathCommand.Source }

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
  }

  foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
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

$apiBaseUrl = "http://{0}:8080/" -f $LanIp
$env:EXPO_PUBLIC_API_BASE_URL = $apiBaseUrl
$env:EXPO_PUBLIC_CUSTOMER_WEB_URL = "http://{0}:3000" -f $LanIp

$script:AdbPath = Resolve-AdbExecutable
Write-Host ("Using ADB: {0}" -f $script:AdbPath)
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Fail "Java 17 or newer is required by Maestro and the Android Gradle build."
}

$script:MaestroPath = Resolve-MaestroExecutable
Write-Host ("Using Maestro CLI: {0}" -f $script:MaestroPath)
$maestroVersion = & $script:MaestroPath --version
if ($LASTEXITCODE -ne 0) { Fail "Maestro CLI was found but could not start. Verify Java 17+ and the Maestro installation." }
if ($maestroVersion) { Write-Host ("Maestro version: {0}" -f ($maestroVersion -join " ")) }

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
