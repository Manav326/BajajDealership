[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$standard = Join-Path $root 'apps/android'
$liquid = Join-Path $root 'apps/android-liquid-glass'
if (-not (Test-Path -LiteralPath $liquid -PathType Container)) { throw 'Liquid Glass Android project folder is missing.' }
$commonFiles = @('App.tsx','CustomerExperience.tsx','index.ts','expo-env.d.ts','tsconfig.json')
foreach ($relative in $commonFiles) {
  $left = Join-Path $standard $relative
  $right = Join-Path $liquid $relative
  if (-not (Test-Path -LiteralPath $left -PathType Leaf) -or -not (Test-Path -LiteralPath $right -PathType Leaf)) { throw ('Required shared Android source file is missing: {0}' -f $relative) }
  $leftHash = (Get-FileHash -LiteralPath $left -Algorithm SHA256).Hash
  $rightHash = (Get-FileHash -LiteralPath $right -Algorithm SHA256).Hash
  if ($leftHash -ne $rightHash) { throw ('Shared customer feature source drift detected in {0}. Apply common changes to both editions.' -f $relative) }
}
$standardFlows = Join-Path $standard '.maestro'
$liquidFlows = Join-Path $liquid '.maestro'
$leftFiles = @(Get-ChildItem -LiteralPath $standardFlows -File -Recurse | ForEach-Object { $_.FullName.Substring($standardFlows.Length).TrimStart([IO.Path]::DirectorySeparatorChar) } | Sort-Object)
$rightFiles = @(Get-ChildItem -LiteralPath $liquidFlows -File -Recurse | ForEach-Object { $_.FullName.Substring($liquidFlows.Length).TrimStart([IO.Path]::DirectorySeparatorChar) } | Sort-Object)
if (Compare-Object -ReferenceObject $leftFiles -DifferenceObject $rightFiles) { throw 'Standard and Liquid Glass Maestro flow file sets differ.' }
foreach ($relative in $leftFiles) {
  $leftContent = Get-Content -Raw -LiteralPath (Join-Path $standardFlows $relative)
  $rightContent = Get-Content -Raw -LiteralPath (Join-Path $liquidFlows $relative)
  if ($leftContent.Contains('appId:')) {
    if (-not $leftContent.Contains('appId: com.quantaedge.luckybajaj') -or $leftContent.Contains('appId: com.quantaedge.luckybajajlg')) { throw ('Standard Maestro flow has the wrong appId: {0}' -f $relative) }
  }
  if ($rightContent.Contains('appId:')) {
    if (-not $rightContent.Contains('appId: com.quantaedge.luckybajajlg') -or $rightContent.Contains('appId: com.quantaedge.luckybajaj' + "`n") -or $rightContent.Contains('appId: com.quantaedge.luckybajaj' + "`r`n")) { throw ('Liquid Glass Maestro flow has the wrong appId: {0}' -f $relative) }
  }
  $leftNormalized = $leftContent.Replace('appId: com.quantaedge.luckybajaj', 'appId: __EDITION_PACKAGE__')
  $rightNormalized = $rightContent.Replace('appId: com.quantaedge.luckybajajlg', 'appId: __EDITION_PACKAGE__')
  if ($leftNormalized -cne $rightNormalized) { throw ('Maestro workflow logic drift detected in {0}. Only appId may differ between editions.' -f $relative) }
}
$standardPackage = Get-Content -Raw -LiteralPath (Join-Path $standard 'package.json') | ConvertFrom-Json
$liquidPackage = Get-Content -Raw -LiteralPath (Join-Path $liquid 'package.json') | ConvertFrom-Json
foreach ($scope in @('dependencies','devDependencies')) {
  $standardDeps = $standardPackage.$scope
  $liquidDeps = $liquidPackage.$scope
  foreach ($name in $standardDeps.PSObject.Properties.Name) {
    if (-not $liquidDeps.PSObject.Properties.Name.Contains($name)) { throw ('Liquid Glass is missing shared dependency {0}.' -f $name) }
    if ([string]$standardDeps.$name -ne [string]$liquidDeps.$name) { throw ('Shared dependency version drift for {0}.' -f $name) }
  }
}
$standardConfig = Get-Content -Raw -LiteralPath (Join-Path $standard 'app.config.ts')
$liquidConfig = Get-Content -Raw -LiteralPath (Join-Path $liquid 'app.config.ts')
if ($standardConfig -notmatch "package:\s*'com\.quantaedge\.luckybajaj'") { throw 'Standard package ID changed unexpectedly.' }
if ($liquidConfig -notmatch "package:\s*'com\.quantaedge\.luckybajajlg'") { throw 'Liquid Glass package ID is not correct.' }
if ($standardConfig -notmatch "scheme:\s*'luckybajaj'") { throw 'Standard deep-link scheme changed unexpectedly.' }
if ($liquidConfig -notmatch "scheme:\s*'luckybajajlg'") { throw 'Liquid Glass deep-link scheme is not correct.' }
$standardTheme = Get-Content -Raw -LiteralPath (Join-Path $standard 'theme.ts')
$liquidTheme = Get-Content -Raw -LiteralPath (Join-Path $liquid 'theme.ts')
if ($standardTheme -notmatch 'LIQUID_GLASS\s*=\s*false' -or $liquidTheme -notmatch 'LIQUID_GLASS\s*=\s*true') { throw 'Edition theme flags are incorrectly configured.' }
Write-Host ('Android edition parity passed: {0} shared source files, {1} shared Maestro files, aligned common dependencies and separate app identities.' -f $commonFiles.Count, $leftFiles.Count) -ForegroundColor Green
