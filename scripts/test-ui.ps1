[CmdletBinding()]
param(
    [ValidateSet('Web', 'Android', 'Both')]
    [string]$Target = 'Web'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot 'apps/web'
$customerWebDir = Join-Path $repoRoot 'apps/customer-web'
$androidDir = Join-Path $repoRoot 'apps/android'
$maestroFlow = Join-Path $repoRoot '.maestro/flows/customer-auth-smoke.yaml'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-LastExit([string]$Action) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

function Assert-Node {
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
        -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Node.js 24+ and npm are required. Install Node.js 24 LTS, reopen PowerShell, and run this command again.'
    }
    $major = [int]((& node -p "Number(process.versions.node.split('.')[0])").Trim())
    if ($major -lt 24) {
        throw "Node.js 24+ is required by this repository; detected Node.js $((& node --version).Trim())."
    }
}

function Ensure-NpmDependencies([string]$Directory, [string]$Marker, [string]$Label) {
    if (Test-Path $Marker) { return }
    Write-Step "Installing $Label dependencies (without creating a lockfile)"
    Push-Location $Directory
    try {
        & npm.cmd install --no-package-lock --no-audit --no-fund
        Assert-LastExit "npm install for $Label"
    }
    finally {
        Pop-Location
    }
}

function Initialize-WebTesting {
    Assert-Node
    Ensure-NpmDependencies $webDir (Join-Path $webDir 'node_modules/@playwright/test/package.json') 'staff portal / Playwright'
    Ensure-NpmDependencies $customerWebDir (Join-Path $customerWebDir 'node_modules/vite/package.json') 'customer website'

    Write-Step 'Checking the Playwright Chromium browser'
    Push-Location $webDir
    try {
        & npx.cmd playwright install chromium
        Assert-LastExit 'Playwright Chromium installation'
    }
    finally {
        Pop-Location
    }
}

function Run-WebTesting {
    Initialize-WebTesting
    Write-Host 'Staff test site:    http://127.0.0.1:3101 (keeps Docker staff portal :3001 untouched)'
    Write-Host 'Customer test site: http://127.0.0.1:4173'
    Push-Location $webDir
    try {
        if ($Target -eq 'Web') {
            Write-Step 'Opening interactive Playwright UI Mode'
            & npx.cmd playwright test --ui
        }
        else {
            Write-Step 'Running the web test suite in a visible Chromium browser'
            & npx.cmd playwright test --headed --workers=1
        }
        Assert-LastExit 'Playwright web tests'
    }
    finally {
        Pop-Location
    }
}

function Get-AndroidSdk {
    $sdk = $env:ANDROID_HOME
    if ([string]::IsNullOrWhiteSpace($sdk)) { $sdk = $env:ANDROID_SDK_ROOT }
    if ([string]::IsNullOrWhiteSpace($sdk)) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }

    $adbPath = Join-Path $sdk 'platform-tools/adb.exe'
    if (-not (Test-Path $adbPath)) {
        throw "Android SDK platform-tools were not found at '$sdk'. Install Android Studio and its Android SDK/platform-tools, then rerun this command."
    }

    $requiredSdkPackages = @{
        'Android SDK Platform 36' = (Join-Path $sdk 'platforms/android-36')
        'Android SDK Build Tools 36.0.0' = (Join-Path $sdk 'build-tools/36.0.0')
        'Android NDK 27.1.12297006' = (Join-Path $sdk 'ndk/27.1.12297006')
    }
    $missingPackages = @($requiredSdkPackages.GetEnumerator() | Where-Object { -not (Test-Path $_.Value) } | ForEach-Object { $_.Key })
    if ($missingPackages.Count -gt 0) {
        throw "Android SDK is missing: $($missingPackages -join ', '). Open Android Studio > Tools > SDK Manager and install these exact packages, then rerun this command."
    }

    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $env:PATH = "$(Join-Path $sdk 'platform-tools');$(Join-Path $sdk 'emulator');$env:PATH"
    return @{ Root = $sdk; Adb = $adbPath }
}

function Assert-Java17 {
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $configuredJava = Join-Path $env:JAVA_HOME 'bin/java.exe'
        if (-not (Test-Path $configuredJava)) {
            throw "JAVA_HOME points to '$env:JAVA_HOME', which does not contain bin/java.exe. Correct JAVA_HOME or clear it and rerun."
        }
        $env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$env:PATH"
    }

    $java = Get-Command java -ErrorAction SilentlyContinue
    if (-not $java) {
        $jdkCandidates = @(
            (Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'),
            (Join-Path $env:ProgramFiles 'Eclipse Adoptium/jdk-21'),
            (Join-Path $env:ProgramFiles 'Java/jdk-21'),
            (Join-Path $env:LOCALAPPDATA 'Programs/Eclipse Adoptium/jdk-21')
        ) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin/java.exe')) }
        if ($jdkCandidates.Count -gt 0) {
            $env:JAVA_HOME = $jdkCandidates[0]
            $env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$env:PATH"
            $java = Get-Command java -ErrorAction SilentlyContinue
        }
    }
    if (-not $java) {
        throw 'Java 17+ is required by Android builds and Maestro. Install JDK 17 or 21, set JAVA_HOME, reopen PowerShell, and retry.'
    }

    $versionText = (& java -version 2>&1 | Out-String)
    $match = [regex]::Match($versionText, 'version "?(?<major>\d+)')
    if (-not $match.Success -or [int]$match.Groups['major'].Value -lt 17) {
        throw "Java 17+ is required. Detected: $($versionText.Trim())"
    }

    if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $javaPath = $java.Source
        $candidate = Split-Path -Parent (Split-Path -Parent $javaPath)
        if (Test-Path (Join-Path $candidate 'bin/java.exe')) {
            $env:JAVA_HOME = $candidate
        }
        else {
            throw 'Java 17+ was found, but JAVA_HOME is not set to its JDK folder. Set JAVA_HOME, reopen PowerShell, and retry.'
        }
    }
}

function Ensure-Maestro {
    if (Get-Command maestro -ErrorAction SilentlyContinue) { return }

    $maestroHome = Join-Path $env:LOCALAPPDATA 'QuantaEdge/tools/maestro'
    $maestroBin = Join-Path $maestroHome 'bin'
    if (Test-Path $maestroBin) {
        $env:PATH = "$maestroBin;$env:PATH"
        if (Get-Command maestro -ErrorAction SilentlyContinue) { return }
    }

    Write-Step 'Installing the free Maestro CLI into your Windows user tools folder'
    $tempRoot = Join-Path $env:TEMP ("qe-maestro-" + [guid]::NewGuid().ToString('N'))
    $zipPath = Join-Path $tempRoot 'maestro.zip'
    $extractPath = Join-Path $tempRoot 'extract'
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    try {
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip' -OutFile $zipPath
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

        $source = $null
        if (Test-Path (Join-Path $extractPath 'bin')) {
            $source = Get-Item $extractPath
        }
        else {
            $source = Get-ChildItem -Path $extractPath -Directory -Recurse |
                Where-Object { Test-Path (Join-Path $_.FullName 'bin') } |
                Select-Object -First 1
        }
        if (-not $source) {
            throw 'The downloaded Maestro archive did not contain the expected bin folder. No system PATH was changed.'
        }

        if (Test-Path $maestroHome) { Remove-Item $maestroHome -Recurse -Force }
        New-Item -ItemType Directory -Path $maestroHome -Force | Out-Null
        Get-ChildItem -Path $source.FullName -Force |
            Copy-Item -Destination $maestroHome -Recurse -Force
        $env:PATH = "$maestroBin;$env:PATH"
        if (-not (Get-Command maestro -ErrorAction SilentlyContinue)) {
            throw "Maestro was extracted to '$maestroHome', but its CLI launcher was not found in bin."
        }
    }
    finally {
        if (Test-Path $tempRoot) { Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Get-ReadyAndroidDevice([hashtable]$SdkInfo) {
    $adb = $SdkInfo.Adb
    & $adb start-server | Out-Null
    $rows = & $adb devices
    $devices = @($rows | Where-Object { $_ -match '^\S+\s+device(\s|$)' -and $_ -notmatch '^List of devices' } |
        ForEach-Object { ($_ -split '\s+')[0] })

    if ($devices.Count -eq 0) {
        $emulatorExe = Join-Path $SdkInfo.Root 'emulator/emulator.exe'
        $avds = @()
        if (Test-Path $emulatorExe) {
            $avds = @(& $emulatorExe -list-avds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        }
        if ($avds.Count -eq 0) {
            throw 'No Android device or configured emulator is available. Connect an Android phone with USB debugging enabled, or create an Android Virtual Device once in Android Studio; this script will launch an existing AVD automatically.'
        }

        Write-Step "Starting the existing Android emulator '$($avds[0])'"
        Start-Process -FilePath $emulatorExe -ArgumentList @('-avd', $avds[0]) | Out-Null
        for ($attempt = 1; $attempt -le 120; $attempt++) {
            Start-Sleep -Seconds 5
            $rows = & $adb devices
            $devices = @($rows | Where-Object { $_ -match '^\S+\s+device(\s|$)' -and $_ -notmatch '^List of devices' } |
                ForEach-Object { ($_ -split '\s+')[0] })
            if ($devices.Count -gt 0) { break }
        }
    }

    if ($devices.Count -eq 0) {
        throw 'Android emulator did not become available. Open Android Studio, start the AVD manually, and retry.'
    }
    $device = $devices[0]
    Write-Host "Using Android device: $device" -ForegroundColor Green

    Write-Step 'Waiting for Android to finish booting'
    for ($attempt = 1; $attempt -le 120; $attempt++) {
        $bootState = (& $adb -s $device shell getprop sys.boot_completed 2>$null | Out-String).Trim()
        if ($bootState -eq '1') { return $device }
        Start-Sleep -Seconds 5
    }
    throw "Android device '$device' did not finish booting in time."
}

function Run-AndroidTesting {
    Assert-Node
    Assert-Java17
    $sdkInfo = Get-AndroidSdk
    Ensure-Maestro

    Write-Step 'Validating the Maestro flow YAML'
    & maestro check-syntax $maestroFlow
    Assert-LastExit 'Maestro flow syntax validation'

    $device = Get-ReadyAndroidDevice $sdkInfo
    Ensure-NpmDependencies $androidDir (Join-Path $androidDir 'node_modules/expo/package.json') 'Android app / Expo'

    Write-Step 'Building and installing the Android app for a native UI test'
    # Respect an explicit shell override first, then apps/android/.env, then the preview API default.
    $oldApiUrl = $env:EXPO_PUBLIC_API_BASE_URL
    $apiBaseUrl = $oldApiUrl
    if ([string]::IsNullOrWhiteSpace($apiBaseUrl)) {
        $androidEnvFile = Join-Path $androidDir '.env'
        if (Test-Path $androidEnvFile) {
            $apiLine = Get-Content $androidEnvFile |
                Where-Object { $_ -match '^\s*EXPO_PUBLIC_API_BASE_URL\s*=' } |
                Select-Object -First 1
            if ($apiLine) { $apiBaseUrl = ($apiLine -split '=', 2)[1].Trim().Trim('"').Trim("'") }
        }
    }
    if ([string]::IsNullOrWhiteSpace($apiBaseUrl)) {
        $apiBaseUrl = 'https://lucky-bajaj-api.onrender.com/'
    }
    $env:EXPO_PUBLIC_API_BASE_URL = $apiBaseUrl
    Write-Host "Android API target: $apiBaseUrl"
    Push-Location $androidDir
    try {
        & npx.cmd expo run:android --variant release --device $device --no-bundler
        Assert-LastExit 'Expo Android release build/install'
    }
    finally {
        Pop-Location
        if ($null -eq $oldApiUrl) {
            Remove-Item Env:EXPO_PUBLIC_API_BASE_URL -ErrorAction SilentlyContinue
        }
        else {
            $env:EXPO_PUBLIC_API_BASE_URL = $oldApiUrl
        }
    }

    Write-Step 'Running the native Android Maestro smoke flow'
    & maestro --device $device test $maestroFlow
    Assert-LastExit 'Maestro Android tests'
}

if ($Target -in @('Web', 'Both')) {
    Run-WebTesting
}
if ($Target -in @('Android', 'Both')) {
    Run-AndroidTesting
}

Write-Host ''
Write-Host "UI testing run completed for target '$Target'." -ForegroundColor Green
