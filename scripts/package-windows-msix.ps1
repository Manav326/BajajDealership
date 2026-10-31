[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$PackageName,
  [Parameter(Mandatory = $true)][string]$Publisher,
  [Parameter(Mandatory = $true)][string]$PublisherDisplayName,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-BoundedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$ArgumentList,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)][string]$Description,
    [int[]]$SuccessExitCodes = @(0)
  )

  Write-Host "Starting $Description (timeout: $TimeoutSeconds seconds)."
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru -NoNewWindow
  try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Write-Warning "$Description exceeded its $TimeoutSeconds-second timeout. Terminating the process tree."
      try {
        $process.Kill($true)
        [void]$process.WaitForExit(10000)
      } catch {
        Write-Warning "Could not fully terminate $Description - $($_.Exception.Message)"
      }
      throw "$Description timed out after $TimeoutSeconds seconds."
    }

    $process.Refresh()
    if ($process.ExitCode -notin $SuccessExitCodes) {
      throw "$Description failed with exit code $($process.ExitCode)."
    }
    Write-Host "$Description completed with exit code $($process.ExitCode)."
    return $process.ExitCode
  } finally {
    $process.Dispose()
  }
}

if ($PackageName -notmatch '^[A-Za-z0-9.]{3,50}$') { throw 'Invalid package identity name.' }
if ([string]::IsNullOrWhiteSpace($Publisher) -or [string]::IsNullOrWhiteSpace($PublisherDisplayName)) { throw 'Partner Center publisher values are required.' }
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'MSIX version must have four numeric parts.' }
foreach ($part in $Version.Split('.')) { if ([int]$part -gt 65535) { throw 'MSIX version part exceeds 65535.' } }

$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$exeName = 'lucky-bajaj-desktop.exe'
if ([System.IO.Path]::GetFileName($executable) -ine $exeName) {
  throw "Expected the Tauri application executable '$exeName', received '$([System.IO.Path]::GetFileName($executable))'."
}
$icon = (Resolve-Path -LiteralPath $IconPath).Path
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$temp = Join-Path $tempRoot ([Guid]::NewGuid().ToString('N'))
$stage = Join-Path $temp 'stage'
$verify = Join-Path $temp 'verify'
$out = [System.IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path $stage,$verify,(Split-Path -Parent $out) | Out-Null

try {
  # Tauri embeds the web assets in its executable. Stage the application binary
  # directly rather than running Windows Installer's administrative MSI extraction.
  $stagedExecutable = Join-Path $stage $exeName
  Copy-Item -LiteralPath $executable -Destination $stagedExecutable
  $sourceHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
  $stagedHash = (Get-FileHash -LiteralPath $stagedExecutable -Algorithm SHA256).Hash
  if ($sourceHash -ne $stagedHash) { throw 'The staged Tauri executable does not match the build output.' }

  $assets = Join-Path $stage 'Assets'
  New-Item -ItemType Directory -Force -Path $assets | Out-Null
  Add-Type -AssemblyName System.Drawing
  $ico = [System.Drawing.Icon]::new($icon)
  $bitmap = $ico.ToBitmap()
  try {
    foreach ($size in @(44,50,150)) {
      $image = [System.Drawing.Bitmap]::new($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($image)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($bitmap,0,0,$size,$size)
        $name = if ($size -eq 44) { 'Square44x44Logo.png' } elseif ($size -eq 50) { 'StoreLogo.png' } else { 'Square150x150Logo.png' }
        $image.Save((Join-Path $assets $name),[System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $graphics.Dispose(); $image.Dispose() }
    }
  } finally { $bitmap.Dispose(); $ico.Dispose() }

  $pub = [System.Security.SecurityElement]::Escape($Publisher)
  $pubName = [System.Security.SecurityElement]::Escape($PublisherDisplayName)
  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="$PackageName" Publisher="$pub" Version="$Version" ProcessorArchitecture="x64" />
 <Properties>
  <DisplayName>Lucky Bajaj Desktop</DisplayName>
  <PublisherDisplayName>$pubName</PublisherDisplayName>
  <Logo>Assets\StoreLogo.png</Logo>
 </Properties>
 <Dependencies>
  <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
 </Dependencies>
 <Resources><Resource Language="en-US" /></Resources>
 <Applications>
  <Application Id="LuckyBajajDesktop" Executable="$exeName" EntryPoint="Windows.FullTrustApplication">
   <uap:VisualElements DisplayName="Lucky Bajaj Desktop" Description="Lucky Bajaj dealership workspace for Windows."
    BackgroundColor="#101C35" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" />
  </Application>
 </Applications>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
  [System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'),$manifest,[System.Text.UTF8Encoding]::new($false))

  $sdkRoot = Join-Path "$env:ProgramFiles(x86)" 'Windows Kits\10\bin'
  $makeAppx = Get-ChildItem -LiteralPath $sdkRoot -Filter 'MakeAppx.exe' -File -Recurse |
    Where-Object { $_.Directory.Name -eq 'x64' } |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
    Select-Object -First 1
  if (-not $makeAppx) { throw 'Windows SDK MakeAppx.exe was not found.' }

  $packArguments = 'pack /d "{0}" /p "{1}" /o' -f $stage, $out
  [void](Invoke-BoundedProcess -FilePath $makeAppx.FullName -ArgumentList $packArguments -TimeoutSeconds 120 -Description 'MakeAppx package creation')
  $unpackArguments = 'unpack /p "{0}" /d "{1}" /o' -f $out, $verify
  [void](Invoke-BoundedProcess -FilePath $makeAppx.FullName -ArgumentList $unpackArguments -TimeoutSeconds 120 -Description 'MakeAppx package verification')

  $verifiedManifestPath = Join-Path $verify 'AppxManifest.xml'
  $verifiedExecutablePath = Join-Path $verify $exeName
  if (-not (Test-Path -LiteralPath $verifiedManifestPath) -or -not (Test-Path -LiteralPath $verifiedExecutablePath)) {
    throw 'MSIX verification did not find its manifest and Tauri executable.'
  }
  $verifiedHash = (Get-FileHash -LiteralPath $verifiedExecutablePath -Algorithm SHA256).Hash
  if ($verifiedHash -ne $sourceHash) { throw 'The executable extracted from the MSIX does not match the source binary.' }
  [xml]$verifiedManifest = Get-Content -LiteralPath $verifiedManifestPath -Raw
  $identityNode = $verifiedManifest.Package.Identity
  if ($identityNode.Name -ne $PackageName -or $identityNode.Publisher -ne $Publisher -or $identityNode.Version -ne $Version) {
    throw 'The packaged manifest identity does not match the requested Store package identity.'
  }

  $package = Get-Item -LiteralPath $out
  Write-Host ("Created unsigned Store-submission MSIX: {0:N2} MiB" -f ($package.Length / 1MB))
  Write-Host 'The MSIX contains the verified Tauri executable and package manifest.'
  Write-Host 'Do not distribute this unsigned MSIX directly. Submit it through Partner Center so Microsoft can sign it.'
} finally {
  if (Test-Path -LiteralPath $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
