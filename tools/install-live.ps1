# dsh-pv-home -- live (no-restart) wiring for a DSH profile.
#
# Does exactly three things:
#   1. backs up the profile's cordis.patch.yml,
#   2. creates the node_modules junction that makes the bare package name
#      resolvable from the profile,
#   3. appends one insert row to cordis.patch.yml (existing lines untouched).
#
# It does NOT touch package.json, does NOT run pnpm and does NOT restart DSH.
# The profile's patchReload default is `live`: the CLI watches cordis.patch.yml
# and hot-applies a changed patch list, so refreshing the browser is enough.
#
# NOTE: this file must stay PURE ASCII. Windows PowerShell 5.1 decodes a
# BOM-less file with the system ANSI code page, and CJK bytes there are enough
# to eat a string terminator and fail the whole script with a syntax error
# pointing at an unrelated line.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-live.ps1
#   powershell -ExecutionPolicy Bypass -File tools\install-live.ps1 -Profile web
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = '',
  [string]$PackageDir = ''
)

$ErrorActionPreference = 'Stop'

if ($DshHome -eq '') {
  if ($env:DSH_HOME -ne '' -and $env:DSH_HOME -ne $null) { $DshHome = $env:DSH_HOME }
  else { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
}
if ($PackageDir -eq '') { $PackageDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }

$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
$modulesDir = Join-Path $profileDir 'node_modules'
$linkPath = Join-Path $modulesDir 'dsh-pv-home'

Write-Host "profile    : $profileDir"
Write-Host "package    : $PackageDir"

if (-not (Test-Path $profileDir)) { throw "no such profile directory: $profileDir" }
if (-not (Test-Path $patchFile)) { throw "no cordis.patch.yml in $profileDir" }
if (-not (Test-Path $modulesDir)) { New-Item -ItemType Directory -Path $modulesDir | Out-Null }

# 1. rollback point
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$patchFile.bak-pvhome-$stamp"
Copy-Item $patchFile $backup
Write-Host "backup     : $backup"

# 2. junction
if (Test-Path $linkPath) {
  $existing = (Get-Item $linkPath -Force).Target
  Write-Host "link       : already present -> $existing"
} else {
  New-Item -ItemType Junction -Path $linkPath -Target $PackageDir | Out-Null
  Write-Host "link       : created -> $PackageDir"
}

# 3. patch row
$text = [System.IO.File]::ReadAllText($patchFile)
if ($text -match 'id:\s*pv-home') {
  Write-Host "patch      : row already present, left untouched"
} else {
  $newline = if ($text -match "`r`n") { "`r`n" } else { "`n" }
  if (-not $text.EndsWith($newline)) { $text += $newline }
  $row = '- insert:' + $newline + '    - id: pv-home' + $newline + '      name: dsh-pv-home' + $newline
  [System.IO.File]::WriteAllText($patchFile, $text + $row)
  Write-Host "patch      : appended the pv-home insert row"
}

Write-Host ''
Write-Host 'done. Refresh the DSH browser window; the home page should take over.'
Write-Host 'the settings card needs a DSH restart (the client module graph is a boot-time snapshot).'
