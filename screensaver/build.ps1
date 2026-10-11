# Build PvScreensaver.scr with the in-box C# compiler, then prove the film decodes.
#
# No SDK, no NuGet, no MSBuild: a .scr is an ordinary Win32 executable and the
# .NET Framework that ships with Windows already has everything this needs
# (csc.exe plus the WPF assemblies under <framework>\WPF).
#
# This file must stay PURE ASCII: Windows PowerShell 5.1 decodes a BOM-less file
# with the system ANSI code page, and CJK bytes there are enough to break the
# parse with an error pointing at an unrelated line.
#
#   powershell -ExecutionPolicy Bypass -File screensaver\build.ps1
param(
  [switch]$SkipSelfTest
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $here 'src\PvScreensaver.cs'
$outDir = Join-Path $here 'build'
$outFile = Join-Path $outDir 'PvScreensaver.scr'

$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $framework 'csc.exe'
$wpf = Join-Path $framework 'WPF'

if (-not (Test-Path $csc)) { throw "no C# compiler at $csc" }
if (-not (Test-Path $source)) { throw "no source at $source" }
if (-not (Test-Path (Join-Path $wpf 'PresentationFramework.dll'))) {
  throw "no WPF assemblies under $wpf"
}
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# System.Windows.Forms is only used for Screen.AllScreens and Graphics.DpiX, and
# System.Drawing only for that DPI probe. Both come from the framework root.
$references = @(
  (Join-Path $wpf 'PresentationFramework.dll'),
  (Join-Path $wpf 'PresentationCore.dll'),
  (Join-Path $wpf 'WindowsBase.dll'),
  (Join-Path $framework 'System.Xaml.dll'),
  (Join-Path $framework 'System.Windows.Forms.dll'),
  (Join-Path $framework 'System.Drawing.dll')
)

Write-Host "compiler : $csc"
Write-Host "output   : $outFile"

$arguments = @('/nologo', '/target:winexe', '/platform:anycpu', "/out:$outFile", "/lib:$wpf", "/lib:$framework", '/warnaserror-')
foreach ($reference in $references) { $arguments += "/reference:$reference" }
$arguments += $source

$output = & $csc @arguments 2>&1
$exit = $LASTEXITCODE
if ($output) { $output | ForEach-Object { Write-Host $_ } }
if ($exit -ne 0 -or -not (Test-Path $outFile)) { throw "compile failed (exit $exit)" }

$info = Get-Item $outFile
Write-Host ("built    : {0} bytes" -f $info.Length)

if ($SkipSelfTest) {
  Write-Host 'selftest : skipped'
  exit 0
}

# The one thing no offline test can answer: does this machine's Media Foundation
# actually open THIS film? /selftest shows no window, so it is safe to run here.
# Rewritten on every build, unconditionally. Gating this on "the file is absent"
# is what let a STALE ini from an earlier build keep the old `muted=0` and made
# the audio assertion below read the wrong configuration — a build artifact that
# is only ever created, never updated, is worse than no artifact.
$ini = Join-Path $outDir 'pv-screensaver.ini'
$video = Join-Path (Split-Path -Parent $here) 'assets\video\film.mp4'
@(
  '# dsh-pv-home screen saver: which film to play, and how loud.',
  '# Paths may be relative to this file. Rewritten by build.ps1 on every build;',
  '# the INSTALLED copy is written by install.ps1 and is the one that matters.',
  "video=$video",
  '# Silent by default: a screen saver fires when nobody is in the room.',
  'muted=1',
  'volume=1',
  '# all = film on every monitor (only the primary one is unmuted); primary = film on one.',
  'screens=all'
) | Set-Content -Path $ini -Encoding ASCII
Write-Host "ini      : written ($ini)"

$resultFile = Join-Path $env:TEMP 'pv-screensaver-selftest.txt'
if (Test-Path $resultFile) { Remove-Item $resultFile -Force }

# NOT Start-Process: `.scr` is associated in the registry as `"%1" /S`, so a
# ShellExecute launch appends /S and throws away the arguments passed here,
# which silently ran the saver fullscreen instead of the self-test. cmd /c goes
# through CreateProcess and hands the arguments over verbatim.
cmd /c "`"$outFile`" /selftest `"$resultFile`""
$selftestExit = $LASTEXITCODE
Write-Host ("selftest : exit {0}" -f $selftestExit)
if (Test-Path $resultFile) {
  Get-Content $resultFile | ForEach-Object { Write-Host "           $_" }
} else {
  Write-Host '           (no result file)'
}
if ($selftestExit -ne 0) { throw 'selftest did not report a decodable film' }

# Geometry is the other half of "will /s actually cover the screen": one window
# per monitor, positioned in DIPs from device-pixel bounds.
$geomFile = Join-Path $env:TEMP 'pv-screensaver-geom.txt'

function Invoke-GeomProbe {
  if (Test-Path $geomFile) { Remove-Item $geomFile -Force }
  cmd /c "`"$outFile`" /geom `"$geomFile`""
  if (-not (Test-Path $geomFile)) { throw 'geometry probe produced no report' }
  return Get-Content $geomFile
}

$geom = Invoke-GeomProbe
$geom | ForEach-Object { Write-Host "           $_" }
if (-not ($geom -match 'video=set')) { throw 'geometry probe reports the film is missing' }
if (-not ($geom -match 'windows=[1-9]')) { throw 'geometry probe found no monitors' }

# The doubled-soundtrack regression, asserted rather than described: on this
# two-monitor machine, turning sound ON must still yield exactly ONE unmuted
# window, and turning it off must yield none. Both directions are probed, then
# the ini is put back.
function Set-IniMuted([string]$value) {
  (Get-Content $ini) | ForEach-Object { if ($_ -match '^muted=') { "muted=$value" } else { $_ } } |
    Set-Content -Path $ini -Encoding ASCII
}
function Get-AudioWindows {
  $line = (Invoke-GeomProbe | Where-Object { $_ -match '^audioWindows=' }) -join ''
  if ($line -notmatch '^audioWindows=(\d+)$') { throw "geometry probe said nothing about audio: $line" }
  return [int]$Matches[1]
}

$originalIni = Get-Content $ini -Raw
try {
  Set-IniMuted 0
  $withSound = Get-AudioWindows
  Write-Host "           (muted=0) audioWindows=$withSound"
  if ($withSound -ne 1) { throw "with sound on, exactly one window may be unmuted, got $withSound" }

  Set-IniMuted 1
  $silent = Get-AudioWindows
  Write-Host "           (muted=1) audioWindows=$silent"
  if ($silent -ne 0) { throw "a muted saver must open no audio at all, got $silent" }
} finally {
  Set-Content -Path $ini -Value $originalIni -Encoding ASCII -NoNewline
}
Write-Host 'ok       : film decodes, monitors are covered, and exactly one window owns the sound'

# `/lock` is what makes the lock button mean "play the film, THEN lock". The lock
# call itself sits on the exit path and cannot be exercised without locking the
# machine, so the ARGUMENT is what gets asserted: parsed when passed, absent when not.
function Invoke-LockArgProbe([switch]$WithLock) {
  if (Test-Path $geomFile) { Remove-Item $geomFile -Force }
  if ($WithLock) { cmd /c "`"$outFile`" /geom `"$geomFile`" /lock" }
  else { cmd /c "`"$outFile`" /geom `"$geomFile`"" }
  return (Get-Content $geomFile | Where-Object { $_ -match '^lockOnExit=' }) -join ''
}

$without = Invoke-LockArgProbe
$with = Invoke-LockArgProbe -WithLock
Write-Host "           (no flag) $without"
Write-Host "           (/lock)   $with"
if ($without -ne 'lockOnExit=False') { throw "lockOnExit must default to False, got: $without" }
if ($with -ne 'lockOnExit=True') { throw "/lock must be parsed from any position, got: $with" }
Write-Host 'ok       : /lock is parsed, and defaults off'
