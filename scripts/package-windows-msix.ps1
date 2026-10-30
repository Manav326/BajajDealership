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
$extractProcess = Start-Process -FilePath $msiexec -ArgumentList $extractArguments -Wait -PassThru -NoNewWindow
if ($extractProcess.ExitCode -notin @(0,3010)) {
  throw "MSI administrative extraction failed: $($extractProcess.ExitCode)"
}

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
$packProcess = Start-Process -FilePath $makeAppx.FullName -ArgumentList $packArguments -Wait -PassThru -NoNewWindow
if ($packProcess.ExitCode -ne 0) { throw "MakeAppx pack failed: $($packProcess.ExitCode)" }
$unpackArguments = 'unpack /p "{0}" /d "{1}" /o' -f $out, $verify
$unpackProcess = Start-Process -FilePath $makeAppx.FullName -ArgumentList $unpackArguments -Wait -PassThru -NoNewWindow
if ($unpackProcess.ExitCode -ne 0) { throw "MakeAppx unpack verification failed: $($unpackProcess.ExitCode)" }
if (-not (Test-Path (Join-Path $verify 'AppxManifest.xml')) -or -not (Test-Path (Join-Path $verify $exeName))) { throw 'MSIX verification did not find manifest and executable.' }
Write-Host "Created unsigned Store-submission MSIX: $out"
Write-Host 'Do not distribute this unsigned MSIX directly. Submit it through Partner Center so Microsoft can sign it.'
