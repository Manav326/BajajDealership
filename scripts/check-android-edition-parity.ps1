# Enforce shared customer functionality/test flows across Standard and Liquid Glass editions.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$standard = Join-Path $root 'apps/android'
$liquid = Join-Path $root 'apps/android-liquid-glass'
if (-not (Test-Path $liquid)) { throw 'Liquid Glass Android project folder is missing.' }
$commonFiles = @('App.tsx','CustomerExperience.tsx','index.ts','expo-env.d.ts','tsconfig.json')
foreach ($relative in $commonFiles) {
  $left = Join-Path $standard $relative; $right = Join-Path $liquid $relative
  if (-not (Test-Path $left -PathType Leaf) -or -not (Test-Path $right -PathType Leaf)) { throw "Required shared Android source file is missing: $relative" }
  if ((Get-FileHash -LiteralPath $left -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $right -Algorithm SHA256).Hash) { throw "Shared feature source drift in $relative. Apply common changes to both editions; only theme.ts and GlassEffects.tsx are edition-specific." }
}
$standardFlows = Join-Path $standard '.maestro'; $liquidFlows = Join-Path $liquid '.maestro'
$leftFiles = @(Get-ChildItem -LiteralPath $standardFlows -File -Recurse | ForEach-Object { $_.FullName.Substring($standardFlows.Length).TrimStart([IO.Path]::DirectorySeparatorChar) } | Sort-Object)
$rightFiles = @(Get-ChildItem -LiteralPath $liquidFlows -File -Recurse | ForEach-Object { $_.FullName.Substring($liquidFlows.Length).TrimStart([IO.Path]::DirectorySeparatorChar) } | Sort-Object)
if (Compare-Object -ReferenceObject $leftFiles -DifferenceObject $rightFiles) { throw 'Standard and Liquid Glass Maestro flow file sets differ.' }
foreach ($relative in $leftFiles) { if ((Get-FileHash -LiteralPath (Join-Path $standardFlows $relative) -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $liquidFlows $relative) -Algorithm SHA256).Hash) { throw "Maestro flow drift in $relative." } }
$standardPackage = Get-Content -Raw -LiteralPath (Join-Path $standard 'package.json') | ConvertFrom-Json
$liquidPackage = Get-Content -Raw -LiteralPath (Join-Path $liquid 'package.json') | ConvertFrom-Json
foreach ($scope in @('dependencies','devDependencies')) { $a=$standardPackage.$scope; $b=$liquidPackage.$scope; foreach ($name in $a.PSObject.Properties.Name) { if (-not $b.PSObject.Properties.Name.Contains($name)) { throw "Liquid Glass is missing shared dependency '$name'." }; if ([string]$a.$name -ne [string]$b.$name) { throw "Dependency version drift for '$name'." } } }
$standardConfig=Get-Content -Raw (Join-Path $standard 'app.config.ts'); $liquidConfig=Get-Content -Raw (Join-Path $liquid 'app.config.ts')
if ($standardConfig -notmatch "package:\s*'com\.quantaedge\.luckybajaj'") { throw 'Standard package ID changed unexpectedly.' }
if ($liquidConfig -notmatch "package:\s*'com\.quantaedge\.luckybajajlg'") { throw 'Liquid Glass package ID is incorrect.' }
if ($standardConfig -notmatch "scheme:\s*'luckybajaj'") { throw 'Standard deep-link scheme changed.' }
if ($liquidConfig -notmatch "scheme:\s*'luckybajajlg'") { throw 'Liquid Glass deep-link scheme is incorrect.' }
$standardTheme=Get-Content -Raw (Join-Path $standard 'theme.ts'); $liquidTheme=Get-Content -Raw (Join-Path $liquid 'theme.ts')
if ($standardTheme -notmatch 'LIQUID_GLASS\s*=\s*false' -or $liquidTheme -notmatch 'LIQUID_GLASS\s*=\s*true') { throw 'Edition theme flags are incorrect.' }
Write-Host "Android edition parity passed: $($commonFiles.Count) shared source files, $($leftFiles.Count) shared Maestro files, shared dependency versions and independent app identities." -ForegroundColor Green
