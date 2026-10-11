# dsh-pv-home -- undo tools/install-live.ps1.
#
# Removes the insert row this installer appended and the node_modules junction,
# then asserts the patch file is byte-identical to the backup taken at install
# time (your own lines, comments, line endings and trailing newline included).
#
# This file must stay PURE ASCII; see the note in install-live.ps1.
#
#   powershell -ExecutionPolicy Bypass -File tools\uninstall-live.ps1
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

if ($DshHome -eq '') {
  if ($env:DSH_HOME -ne '' -and $env:DSH_HOME -ne $null) { $DshHome = $env:DSH_HOME }
  else { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
}

$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
$linkPath = Join-Path (Join-Path $profileDir 'node_modules') 'dsh-pv-home'

if (-not (Test-Path $patchFile)) { throw "no cordis.patch.yml in $profileDir" }

$text = [System.IO.File]::ReadAllText($patchFile)
$newline = if ($text -match "`r`n") { "`r`n" } else { "`n" }
$row = '- insert:' + $newline + '    - id: pv-home' + $newline + '      name: dsh-pv-home' + $newline

if ($text.Contains($row)) {
  $text = $text.Replace($row, '')
  [System.IO.File]::WriteAllText($patchFile, $text)
  Write-Host 'patch      : pv-home insert row removed'
} else {
  Write-Host 'patch      : no pv-home insert row found, left untouched'
}

if (Test-Path $linkPath) {
  # A junction is a directory; -Force keeps the target's contents alone.
  [System.IO.Directory]::Delete($linkPath, $false)
  Write-Host 'link       : removed'
} else {
  Write-Host 'link       : not present'
}

$backups = Get-ChildItem "$patchFile.bak-pvhome-*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime
if ($backups.Count -gt 0) {
  $latest = $backups[-1]
  $now = [System.IO.File]::ReadAllText($patchFile)
  $was = [System.IO.File]::ReadAllText($latest.FullName)
  if ($now -eq $was) {
    Write-Host "verify     : patch file is byte-identical to $($latest.Name)"
  } else {
    Write-Host "verify     : FILE DIFFERS from $($latest.Name) -- other edits happened after the install; nothing was reverted"
  }
}

Write-Host ''
Write-Host 'done. Refresh (or restart) DSH; the native boot page is back.'
