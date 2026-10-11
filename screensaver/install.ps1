# Install the PV screen saver for the current user.
#
# Copies the built .scr and its ini into a per-user directory and points Windows
# at them. It writes ONLY the four Screen Saver values under
# HKCU\Control Panel\Desktop, backs up their previous values first, and pushes the
# change into the running session with SystemParametersInfo so no sign-out is
# needed.
#
# This file must stay PURE ASCII: Windows PowerShell 5.1 decodes a BOM-less file
# with the system ANSI code page, and CJK bytes there are enough to break the
# parse with an error pointing at an unrelated line.
#
#   powershell -ExecutionPolicy Bypass -File screensaver\install.ps1
#   powershell -ExecutionPolicy Bypass -File screensaver\install.ps1 -TimeoutMinutes 5 -Muted 1
param(
  [int]$TimeoutMinutes = 10,
  [ValidateSet(0, 1)][int]$Secure = 1,
  # Silent by default: a screen saver fires when nobody is in the room, and the
  # first version of this one started singing. Pass -Muted 0 to enable sound.
  [ValidateSet(0, 1)][int]$Muted = 1,
  [double]$Volume = 1.0,
  # all = film on every monitor (only the primary one is ever unmuted);
  # primary = film on the primary monitor and black elsewhere.
  [ValidateSet('all', 'primary')][string]$Screens = 'all',
  [string]$Video = ''
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$built = Join-Path $here 'build\PvScreensaver.scr'
if (-not (Test-Path $built)) { throw "not built yet: $built (run build.ps1 first)" }

if ($Video -eq '') {
  $candidate = Join-Path (Split-Path -Parent $here) 'assets\video\film.mp4'
  if (-not (Test-Path $candidate)) { throw "no film at $candidate; pass -Video <path>" }
  $Video = $candidate
}
if (-not (Test-Path $Video)) { throw "video not found: $Video" }

$target = Join-Path $env:LOCALAPPDATA 'dsh-pv-home'
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }

$scrPath = Join-Path $target 'PvScreensaver.scr'
$iniPath = Join-Path $target 'pv-screensaver.ini'
$backupPath = Join-Path $target 'previous-screensaver.json'

$key = 'HKCU:\Control Panel\Desktop'
$names = @('SCRNSAVE.EXE', 'ScreenSaveActive', 'ScreenSaveTimeOut', 'ScreenSaverIsSecure')
$previous = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
$snapshot = @{}
foreach ($name in $names) { $snapshot[$name] = if ($previous -ne $null) { $previous.$name } else { $null } }
$snapshot['capturedAt'] = (Get-Date -Format o)

if (-not (Test-Path $backupPath)) {
  $snapshot | ConvertTo-Json | Set-Content -Path $backupPath -Encoding UTF8
  Write-Host "backup   : $backupPath"
} else {
  Write-Host "backup   : already present, kept ($backupPath)"
}

Copy-Item $built $scrPath -Force
@(
  '# dsh-pv-home screen saver: which film to play, and how loud.',
  '# Rewritten by screensaver\install.ps1; edit that script, not this file.',
  "video=$Video",
  "muted=$Muted",
  ("volume={0}" -f $Volume),
  "screens=$Screens",
  '# Note: when sound is on, only ONE window is unmuted no matter how many',
  '# monitors there are. Each window decodes the film itself, so unmuting them',
  '# all plays the same soundtrack several times over and it sounds doubled.',
  'clock=0'
) | Set-Content -Path $iniPath -Encoding ASCII
Write-Host "scr      : $scrPath"
Write-Host "ini      : $iniPath (muted=$Muted, screens=$Screens)"

Set-ItemProperty -Path $key -Name 'SCRNSAVE.EXE' -Value $scrPath
Set-ItemProperty -Path $key -Name 'ScreenSaveActive' -Value '1'
Set-ItemProperty -Path $key -Name 'ScreenSaveTimeOut' -Value ([string]($TimeoutMinutes * 60))
Set-ItemProperty -Path $key -Name 'ScreenSaverIsSecure' -Value ([string]$Secure)

# Push it into the running session: the registry alone is only read when the
# desktop re-reads its settings, which normally means a sign-out.
Add-Type -Namespace Win -Name Spi -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, string pvParam, uint fWinIni);
'@

$SPI_SETSCREENSAVEACTIVE = 0x0011
$SPI_SETSCREENTIMEOUT = 0x000F
$SPI_SETSCREENSAVESECURE = 0x0077
$SPIF_UPDATEINIFILE = 0x01
$SPIF_SENDCHANGE = 0x02
$flags = $SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE

$okActive = [Win.Spi]::SystemParametersInfo($SPI_SETSCREENSAVEACTIVE, 1, [IntPtr]::Zero, $flags)
$okTimeout = [Win.Spi]::SystemParametersInfo($SPI_SETSCREENTIMEOUT, [uint32]($TimeoutMinutes * 60), [IntPtr]::Zero, $flags)
$okSecure = [Win.Spi]::SystemParametersInfo($SPI_SETSCREENSAVESECURE, [uint32]$Secure, [IntPtr]::Zero, $flags)

Write-Host ''
Write-Host ("applied  : active={0} timeout={1}s secure={2}" -f $okActive, ($TimeoutMinutes * 60), $okSecure)
Write-Host ("           timeout pushed={0} secure pushed={1}" -f $okTimeout, $okSecure)
Write-Host ''
Write-Host 'done. To see it now: run the .scr with /s, or wait for the idle timeout.'
Write-Host ("  cmd /c `"$scrPath`" /s")
Write-Host 'To preview it inside the Windows dialog: Settings > Personalization > Lock screen > Screen saver.'
Write-Host 'Revert with screensaver\uninstall.ps1'
