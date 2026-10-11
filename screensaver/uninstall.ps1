# Revert screensaver\install.ps1: put the four Screen Saver values back the way
# they were and remove the copied files.
#
# This file must stay PURE ASCII; see the note in install.ps1.
#
#   powershell -ExecutionPolicy Bypass -File screensaver\uninstall.ps1
param(
  [switch]$KeepFiles
)

$ErrorActionPreference = 'Stop'

$target = Join-Path $env:LOCALAPPDATA 'dsh-pv-home'
$scrPath = Join-Path $target 'PvScreensaver.scr'
$backupPath = Join-Path $target 'previous-screensaver.json'
$key = 'HKCU:\Control Panel\Desktop'
$names = @('SCRNSAVE.EXE', 'ScreenSaveActive', 'ScreenSaveTimeOut', 'ScreenSaverIsSecure')

if (-not (Test-Path $backupPath)) {
  Write-Host "no backup at $backupPath; nothing to restore"
  exit 1
}

$snapshot = Get-Content $backupPath -Raw | ConvertFrom-Json
foreach ($name in $names) {
  $value = $snapshot.$name
  if ($value -eq $null -or $value -eq '') {
    Remove-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
    Write-Host "cleared  : $name"
  } else {
    Set-ItemProperty -Path $key -Name $name -Value ([string]$value)
    Write-Host "restored : $name = $value"
  }
}

Add-Type -Namespace Win -Name Spi -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
'@

$active = if ($snapshot.ScreenSaveActive -ne $null) { [uint32]$snapshot.ScreenSaveActive } else { 0 }
$timeout = if ($snapshot.ScreenSaveTimeOut -ne $null) { [uint32]$snapshot.ScreenSaveTimeOut } else { 0 }
[void][Win.Spi]::SystemParametersInfo(0x0011, $active, [IntPtr]::Zero, 3)
[void][Win.Spi]::SystemParametersInfo(0x000F, $timeout, [IntPtr]::Zero, 3)

if (-not $KeepFiles) {
  foreach ($path in @($scrPath, (Join-Path $target 'pv-screensaver.ini'), $backupPath)) {
    if (Test-Path $path) { Remove-Item $path -Force; Write-Host "removed  : $path" }
  }
  if ((Test-Path $target) -and (Get-ChildItem $target -Force | Measure-Object).Count -eq 0) {
    Remove-Item $target -Force
  }
}

Write-Host ''
Write-Host 'done. If the old saver was a system one, it is selected again.'
