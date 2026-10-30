# Download the newest successful Lucky Bajaj Android APK from main and optionally install it with ADB.
# The stable local APK is replaced only after the downloaded artifact is validated.
[CmdletBinding()]
param(
    [string]$Repository = "Manav326/BajajDealership",
    [string]$Branch = "main",
    [string]$ArtifactPattern = "lucky-bajaj-android-debug-apk-*",
    [string]$PackageName = "com.quantaedge.luckybajaj",
    [string]$DeviceSerial = "",
    [switch]$DownloadOnly
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot "artifacts"
$targetApk = Join-Path $targetDir "lucky-bajaj-latest.apk"
$metadataPath = Join-Path $targetDir "lucky-bajaj-latest.apk.json"
$metadataTempPath = Join-Path $targetDir "lucky-bajaj-latest.apk.json.tmp"
$script:LogPath = Join-Path $targetDir "android-install-history.log"
$tempDir = Join-Path $env:TEMP ("lucky-bajaj-apk-" + [guid]::NewGuid().ToString("N"))
$script:ApkSignerPath = $null
$script:AaptPath = $null

function Write-Status([string]$Message, [string]$Color = "Gray") {
    Write-Host $Message -ForegroundColor $Color
    try {
        $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
    } catch {
        Write-Host ("Warning: could not append to history log: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw ("{0} was not found. {1}" -f $Name, $Hint)
    }
}

function Get-AdbPath {
    $sdkRoots = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($sdkRoot in $sdkRoots) {
        $candidate = Join-Path $sdkRoot "platform-tools\adb.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
    if ($adbCommand) { return $adbCommand.Source }
    throw "ADB was not found. Install Android SDK Platform-Tools or add adb.exe to PATH. The script does not install Android SDK components."
}

function Find-AndroidSdkTools([string]$AdbPath) {
    $sdkRoots = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Split-Path -Parent (Split-Path -Parent $AdbPath))
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique

    foreach ($sdkRoot in $sdkRoots) {
        $buildToolsRoot = Join-Path $sdkRoot "build-tools"
        if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) { continue }

        $toolDirectories = @(Get-ChildItem -LiteralPath $buildToolsRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending)
        foreach ($toolDirectory in $toolDirectories) {
            if (-not $script:ApkSignerPath) {
                foreach ($name in @("apksigner.bat", "apksigner.exe")) {
                    $candidate = Join-Path $toolDirectory.FullName $name
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                        $script:ApkSignerPath = $candidate
                        break
                    }
                }
            }
            if (-not $script:AaptPath) {
                $candidate = Join-Path $toolDirectory.FullName "aapt.exe"
                if (Test-Path -LiteralPath $candidate -PathType Leaf) { $script:AaptPath = $candidate }
            }
        }
        if ($script:ApkSignerPath -and $script:AaptPath) { break }
    }
}

function Get-UsableDevices([string]$AdbPath) {
    $output = @(& $AdbPath devices -l 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ("ADB device listing failed: {0}" -f ($output -join " "))
    }

    $found = @()
    foreach ($line in $output) {
        if ([string]$line -match '^([^\s]+)\s+device(?:\s+(.*))?$') {
            $found += [PSCustomObject]@{
                Serial = $matches[1]
                Details = if ($matches[2]) { $matches[2].Trim() } else { "" }
            }
        } elseif ([string]$line -match '^([^\s]+)\s+(unauthorized|offline)$') {
            Write-Status ("ADB device {0} is {1}; it will not be used." -f $matches[1], $matches[2]) "Yellow"
        }
    }
    return $found
}

function Select-Device($Devices, [string]$RequestedSerial) {
    if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
        $match = @($Devices | Where-Object { $_.Serial -eq $RequestedSerial })
        if ($match.Count -ne 1) {
            throw ("ADB device '{0}' is not an authorized connected device. Check 'adb devices -l'." -f $RequestedSerial)
        }
        return $match[0].Serial
    }

    if ($Devices.Count -eq 1) {
        Write-Status ("One authorized Android device found: {0} {1}" -f $Devices[0].Serial, $Devices[0].Details) "Green"
        return $Devices[0].Serial
    }

    Write-Host ""
    Write-Host "Multiple authorized Android devices are connected:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $Devices.Count; $i++) {
        Write-Host ("  [{0}] {1} {2}" -f ($i + 1), $Devices[$i].Serial, $Devices[$i].Details)
    }

    do {
        $raw = Read-Host "Enter the number of the phone to install Lucky Bajaj on (Q to cancel)"
        if ($raw -match '^(q|quit)$') {
            Write-Status ("Installation cancelled. The downloaded APK is saved at {0}." -f $targetApk) "Yellow"
            return $null
        }
        $number = 0
        $valid = [int]::TryParse($raw, [ref]$number) -and $number -ge 1 -and $number -le $Devices.Count
        if (-not $valid) {
            Write-Host ("Enter a number from 1 to {0}, or Q to cancel." -f $Devices.Count) -ForegroundColor Yellow
        }
    } while (-not $valid)

    return $Devices[$number - 1].Serial
}

try {
    $null = New-Item -ItemType Directory -Path $targetDir -Force
    $null = New-Item -ItemType Directory -Path $tempDir -Force
    Write-Status "=== Lucky Bajaj latest Android APK download started ===" "Cyan"
    Write-Status ("Repository: {0}; branch: {1}; artifact pattern: {2}" -f $Repository, $Branch, $ArtifactPattern)

    Require-Command "gh" "Install GitHub CLI from https://cli.github.com/ and run 'gh auth login'."
    $authOutput = @(& gh auth status 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ("GitHub CLI is not authenticated. Run 'gh auth login'. Details: {0}" -f ($authOutput -join " "))
    }

    $adbPath = $null
    if (-not $DownloadOnly) {
        $adbPath = Get-AdbPath
        Find-AndroidSdkTools $adbPath
        if (-not $script:ApkSignerPath) {
            Write-Status "Android SDK apksigner was not found. The APK will still be downloaded; ADB will enforce signing compatibility during install." "Yellow"
        }
        if (-not $script:AaptPath) {
            Write-Status "Android SDK aapt was not found. The APK package ID cannot be pre-checked; the CI artifact name and ADB install result will be used." "Yellow"
        }
    }

    Write-Status ("Finding the newest successful CI run on branch '{0}' that contains an APK..." -f $Branch) "Cyan"
    $runsRaw = @(& gh run list --repo $Repository --branch $Branch --workflow "ci.yml" --limit 100 --json databaseId,workflowName,createdAt,headSha,headBranch,status,conclusion,event)
    $runsExitCode = $LASTEXITCODE
    if ($runsExitCode -ne 0) {
        throw "Could not query GitHub Actions runs with GitHub CLI."
    }

    $runsJson = ($runsRaw | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    try {
        $parsedRuns = ConvertFrom-Json -InputObject $runsJson
        $runs = @($parsedRuns)
    } catch {
        throw ("GitHub CLI returned invalid workflow-run JSON: {0}" -f $runsJson)
    }

    # Android builds are conditional in CI. Skip successful main runs that did not
    # build Android, and keep searching until an unexpired Android artifact is found.
    $candidates = @($runs | Where-Object {
        $_.workflowName -eq "CI" -and
        $_.headBranch -eq $Branch -and
        $_.status -eq "completed" -and
        $_.conclusion -eq "success" -and
        $_.event -notmatch '^pull_request' -and
        $_.headSha -match '^[0-9a-f]{40}$'
    } | Sort-Object createdAt -Descending)

    if ($candidates.Count -eq 0) {
        throw ("No completed successful CI runs were found for branch '{0}'. Check GitHub Actions and try again." -f $Branch)
    }

    $downloadedApk = $null
    $sourceRun = $null
    foreach ($run in $candidates) {
        $runDir = Join-Path $tempDir ([string]$run.databaseId)
        $null = New-Item -ItemType Directory -Path $runDir -Force
        Write-Status ("Checking CI run {0}, commit {1}, created {2}..." -f $run.databaseId, $run.headSha, $run.createdAt) "Cyan"

        $downloadOutput = @(& gh run download ([string]$run.databaseId) --repo $Repository --pattern $ArtifactPattern --dir $runDir 2>&1)
        $downloadExit = $LASTEXITCODE
        if ($downloadExit -eq 0) {
            $apkFiles = @(Get-ChildItem -LiteralPath $runDir -Filter "app-debug.apk" -File -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.Length -gt 1MB } |
                Sort-Object Length -Descending)
            if ($apkFiles.Count -eq 1) {
                $downloadedApk = $apkFiles[0]
                $sourceRun = $run
                break
            }
            Write-Status ("Run {0} did not contain exactly one plausible app-debug.apk; checking an older successful run." -f $run.databaseId) "Yellow"
        } else {
            Write-Status ("No matching, downloadable APK artifact in run {0}; checking an older successful run." -f $run.databaseId) "Yellow"
        }
    }

    if (-not $downloadedApk) {
        throw ("No installable APK matching '{0}' was found in the 100 most recent successful CI runs on '{1}'. Android artifacts are retained for 14 days; run an Android build in CI and try again." -f $ArtifactPattern, $Branch)
    }

    if ($downloadedApk.Length -lt 1MB) {
        throw "The downloaded APK is unexpectedly small. The previously saved APK was not changed."
    }

    # Verify the staging copy before replacing the last known-good local APK.
    $stagedApk = Join-Path $targetDir "lucky-bajaj-latest.staged.apk"
    if (Test-Path -LiteralPath $stagedApk) {
        Remove-Item -LiteralPath $stagedApk -Force
    }
    Copy-Item -LiteralPath $downloadedApk.FullName -Destination $stagedApk
    if (-not (Test-Path -LiteralPath $stagedApk -PathType Leaf) -or
        (Get-Item -LiteralPath $stagedApk).Length -ne $downloadedApk.Length) {
        Remove-Item -LiteralPath $stagedApk -Force -ErrorAction SilentlyContinue
        throw "APK staging verification failed. The previously saved APK was not changed."
    }

    $apkInfo = Get-Item -LiteralPath $stagedApk
    $apkHash = (Get-FileHash -LiteralPath $stagedApk -Algorithm SHA256).Hash
    $signingSha1 = $null

    if ($script:ApkSignerPath) {
        $signerOutput = @(& $script:ApkSignerPath verify --print-certs $stagedApk 2>&1)
        $signerExitCode = $LASTEXITCODE
        $signerText = $signerOutput -join [Environment]::NewLine
        if ($signerExitCode -ne 0) {
            Remove-Item -LiteralPath $stagedApk -Force -ErrorAction SilentlyContinue
            throw ("apksigner rejected the downloaded APK. The previous APK was not changed. Details: {0}" -f $signerText)
        }

        $sha1Match = [regex]::Match($signerText, '(?im)Signer\s+#1\s+certificate\s+SHA-1\s+digest:[ \t]*([0-9a-f:]+)')
        if ($sha1Match.Success) {
            $signingSha1 = ($sha1Match.Groups[1].Value -replace '[^0-9a-fA-F:]', '').ToUpperInvariant()
        }
    }

    if ($script:AaptPath) {
        $badging = @(& $script:AaptPath dump badging $stagedApk 2>&1)
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $stagedApk -Force -ErrorAction SilentlyContinue
            throw "Android aapt could not inspect the downloaded APK. The previous APK was not changed."
        }
        $packageMatch = [regex]::Match(($badging -join [Environment]::NewLine), "package:\s+name='([^']+)'")
        if (-not $packageMatch.Success -or $packageMatch.Groups[1].Value -ne $PackageName) {
            Remove-Item -LiteralPath $stagedApk -Force -ErrorAction SilentlyContinue
            $actualPackage = if ($packageMatch.Success) { $packageMatch.Groups[1].Value } else { "unknown" }
            throw ("APK package mismatch. Expected '{0}', received '{1}'. The previous APK was not changed." -f $PackageName, $actualPackage)
        }
    }

    $artifactName = "lucky-bajaj-android-debug-apk-$($sourceRun.headSha)"
    $metadata = [ordered]@{
        repository = $Repository
        branch = [string]$sourceRun.headBranch
        headSha = [string]$sourceRun.headSha
        artifactName = $artifactName
        artifactPattern = $ArtifactPattern
        runId = [string]$sourceRun.databaseId
        workflowName = [string]$sourceRun.workflowName
        runEvent = [string]$sourceRun.event
        runConclusion = [string]$sourceRun.conclusion
        runCreatedAt = [string]$sourceRun.createdAt
        downloadedAtUtc = [DateTime]::UtcNow.ToString("o")
        packageName = $PackageName
        sizeBytes = [long]$apkInfo.Length
        sha256 = $apkHash
        signingCertificateSha1 = $signingSha1
    }

    $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataTempPath -Encoding UTF8
    Move-Item -LiteralPath $stagedApk -Destination $targetApk -Force
    Move-Item -LiteralPath $metadataTempPath -Destination $metadataPath -Force

    Write-Status "=== Latest available Lucky Bajaj Android APK downloaded ===" "Green"
    Write-Status ("APK file: {0}" -f $targetApk) "Green"
    Write-Status ("Source branch: {0}; commit: {1}" -f $sourceRun.headBranch, $sourceRun.headSha) "Green"
    Write-Status ("Actions run: {0}; created: {1}; result: {2}" -f $sourceRun.databaseId, $sourceRun.createdAt, $sourceRun.conclusion) "Green"
    Write-Status ("File size: {0:N2} MB; SHA-256: {1}" -f ($apkInfo.Length / 1MB), $apkHash) "Green"
    if ($signingSha1) {
        Write-Status ("APK signing certificate SHA-1: {0}" -f $signingSha1) "Green"
    }

    if ($DownloadOnly) {
        Write-Status "Download-only mode requested; ADB installation was skipped." "Yellow"
        return
    }

    Write-Status "Checking connected Android devices through ADB (USB or wireless debugging)..." "Cyan"
    $devices = @(Get-UsableDevices $adbPath)
    if ($devices.Count -eq 0) {
        Write-Status ("No authorized ADB device is connected. The APK is downloaded and ready at {0}. Connect/authorize the phone, then rerun the script." -f $targetApk) "Yellow"
        return
    }

    $selectedSerial = Select-Device $devices $DeviceSerial
    if ([string]::IsNullOrWhiteSpace($selectedSerial)) { return }

    $confirm = Read-Host ("Install Lucky Bajaj APK from commit {0} on device {1}? (Y/N)" -f $sourceRun.headSha, $selectedSerial)
    if ($confirm -notmatch '^(Y|YES)$') {
        Write-Status "Installation cancelled. The downloaded APK remains saved and ready." "Yellow"
        return
    }

    Write-Status ("Installing on Android device {0} with 'adb install -r' (app data is preserved)..." -f $selectedSerial) "Cyan"
    $installOutput = @(& $adbPath -s $selectedSerial install -r $targetApk 2>&1)
    $installCode = $LASTEXITCODE
    foreach ($line in $installOutput) { Write-Host $line }

    if ($installCode -ne 0) {
        $installText = $installOutput -join [Environment]::NewLine
        if ($installText -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
            throw "Android rejected the update because the installed app uses a different signing key. Nothing was uninstalled automatically; the APK remains saved. Uninstalling manually would remove local app data."
        }
        if ($installText -match 'device offline|no devices/emulators found|device not found') {
            throw ("The ADB connection dropped during installation. Reconnect the phone and rerun the script. APK remains at {0}." -f $targetApk)
        }
        throw ("ADB installation failed on {0}. Review the output above. APK remains at {1}." -f $selectedSerial, $targetApk)
    }

    $installedPath = @(& $adbPath -s $selectedSerial shell pm path $PackageName 2>&1)
    if ($LASTEXITCODE -ne 0 -or ($installedPath -join " ") -notmatch 'package:') {
        throw ("ADB reported install success, but package '{0}' could not be verified on device {1}." -f $PackageName, $selectedSerial)
    }

    Write-Status ("SUCCESS: Lucky Bajaj is installed on {0}. App data was retained by the -r update." -f $selectedSerial) "Green"
    Write-Status ("Installed package: {0}" -f $PackageName)
    Write-Status ("History log: {0}" -f $script:LogPath)
} catch {
    Write-Status ("FAILED: {0}" -f $_.Exception.Message) "Red"
    throw
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath (Join-Path $targetDir "lucky-bajaj-latest.staged.apk")) {
        Remove-Item -LiteralPath (Join-Path $targetDir "lucky-bajaj-latest.staged.apk") -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $metadataTempPath) {
        Remove-Item -LiteralPath $metadataTempPath -Force -ErrorAction SilentlyContinue
    }
}
