[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
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

$msi = (Resolve-Path -LiteralPath $MsiPath).Path
$icon = (Resolve-Path -LiteralPath $IconPath).Path
$temp = Join-Path $env:RUNNER_TEMP ([Guid]::NewGuid().ToString('N'))
$extract = Join-Path $temp 'extract'
$stage = Join-Path $temp 'stage'
$verify = Join-Path $temp 'verify'
$out = [System.IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path $extract,$stage,$verify,(Split-Path -Parent $out) | Out-Null

$msiexec = Join-Path $env:WINDIR 'System32\msiexec.exe'
$extractArguments = '/a "{0}" /qn "TARGETDIR={1}"' -f $msi, $extract
[void](Invoke-BoundedProcess -FilePath $msiexec -ArgumentList $extractArguments -TimeoutSeconds 300 -Description 'MSI administrative extraction' -SuccessExitCodes @(0,3010))

$exeName = 'lucky-bajaj-desktop.exe'
$exe = Get-ChildItem -LiteralPath $extract -Filter $exeName -File -Recurse | Select-Object -First 1
if (-not $exe) { throw "The MSI does not contain $exeName." }
Get-ChildItem -LiteralPath $exe.DirectoryName -Force | Copy-Item -Destination $stage -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $stage $exeName))) { throw 'Tauri executable was not staged.' }

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
if (-not (Test-Path (Join-Path $verify 'AppxManifest.xml')) -or -not (Test-Path (Join-Path $verify $exeName))) { throw 'MSIX verification did not find manifest and executable.' }
Write-Host "Created unsigned Store-submission MSIX: $out"
Write-Host 'Do not distribute this unsigned MSIX directly. Submit it through Partner Center so Microsoft can sign it.'
