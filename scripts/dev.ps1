# Starts, stops or reports the local stack (API + Metro), each in its own
# visible Windows Terminal tab.
#
#   powershell -File scripts/dev.ps1              # dev: API on flourish, port 3000
#   powershell -File scripts/dev.ps1 -Mode demo   # demo: API on flourish_demo, port 3000
#   powershell -File scripts/dev.ps1 -Status
#   powershell -File scripts/dev.ps1 -Stop
param(
  [ValidateSet('dev', 'demo')][string]$Mode = 'dev',
  [switch]$Status,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiPort = 3000
$testPort = 3001
$metroPort = 8081
$databases = @{ dev = 'flourish'; demo = 'flourish_demo' }
$scripts = @{ dev = 'dev'; demo = 'dev:demo' }

function Get-ListenerPid([int]$port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  return $null
}

function Get-Proc([int]$procId) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
}

# The outermost process of whatever launched the server on this port: our own
# tab (FLOURISH_TAB marker), an `npm run ...`, or a `concurrently` from
# `npm run android`. Killing it with /T takes the whole chain down, including
# `tsx watch`, which would otherwise restart the server.
function Get-LaunchRoot([int]$procId) {
  $launch = '(FLOURISH_TAB=|npm(-cli\.js"?)?\s+(run\s+\S+|start)|concurrently|react-native(\.js"?)?\s+start)'
  $proc = Get-Proc $procId
  $found = $procId
  while ($proc) {
    if ($proc.CommandLine -match $launch) { $found = [int]$proc.ProcessId }
    if ($proc.Name -notin @('node.exe', 'cmd.exe', 'bash.exe', 'sh.exe')) { break }
    $proc = Get-Proc $proc.ParentProcessId
  }
  return $found
}

function Stop-Port([int]$port) {
  $listener = Get-ListenerPid $port
  if (-not $listener) { return $false }
  $launchRoot = Get-LaunchRoot $listener
  Write-Host "Stopping port $port (process tree $launchRoot)"
  taskkill /PID $launchRoot /T /F | Out-Null
  for ($i = 0; $i -lt 20 -and (Get-ListenerPid $port); $i++) { Start-Sleep -Milliseconds 500 }
  return $true
}

# A second `npm run dev` / `dev:demo` that lost the race for port 3000 keeps
# idling in `tsx watch` and retries on the next file change. Stop those too
# (not dev:test, which E2E runs own).
function Stop-StrayApiServers {
  $stray = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'npm(-cli\.js"?)?\s+run\s+dev(:demo)?(\s|"|$)' }
  foreach ($proc in $stray) {
    $launchRoot = Get-LaunchRoot ([int]$proc.ProcessId)
    if (Get-Proc $launchRoot) {
      Write-Host "Stopping a stray API server (process tree $launchRoot)"
      taskkill /PID $launchRoot /T /F 2>$null | Out-Null
    }
  }
}

# Whether the process on this port was started by this script, in a visible tab.
function Test-OwnTab([int]$port) {
  $listener = Get-ListenerPid $port
  if (-not $listener) { return $false }
  $proc = Get-Proc $listener
  while ($proc) {
    if ($proc.CommandLine -match 'FLOURISH_TAB=') { return $true }
    $proc = Get-Proc $proc.ParentProcessId
  }
  return $false
}

function Get-ApiDatabase([int]$port) {
  try {
    $health = Invoke-RestMethod "http://localhost:$port/health" -TimeoutSec 3
    return $health.database
  } catch { return $null }
}

function Show-Status {
  foreach ($port in @($apiPort, $testPort)) {
    $listener = Get-ListenerPid $port
    if (-not $listener) { Write-Host "API  :$port  not running"; continue }
    $db = Get-ApiDatabase $port
    if (-not $db) { $db = '? (no answer from /health)' }
    $tab = if (Test-OwnTab $port) { 'visible tab' } else { 'started elsewhere (hidden?)' }
    Write-Host "API  :$port  database $db  - $tab"
  }
  if (Get-ListenerPid $metroPort) {
    $tab = if (Test-OwnTab $metroPort) { 'visible tab' } else { 'started elsewhere (hidden?)' }
    Write-Host "Metro :$metroPort  running - $tab"
  } else {
    Write-Host "Metro :$metroPort  not running"
  }
  $devices = adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' }
  if ($devices) {
    foreach ($line in $devices) {
      $serial = ($line -split "`t")[0]
      $top = adb -s $serial shell dumpsys activity activities |
        Select-String -Pattern 'topResumedActivity' | Select-Object -First 1
      $app = if ("$top" -match 'com\.app/') { 'app in front' } else { 'app not in front' }
      Write-Host "Device $serial  - $app"
    }
  } else {
    Write-Host 'Device: none (start an emulator first)'
  }
}

function Wait-Port([int]$port, [int]$seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    if (Get-ListenerPid $port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if ($Status) { Show-Status; exit 0 }

if ($Stop) {
  $stopped = @($apiPort, $metroPort) | Where-Object { Stop-Port $_ }
  Stop-StrayApiServers
  if (-not $stopped) { Write-Host 'Nothing was running on 3000 or 8081.' }
  exit 0
}

$wantedDb = $databases[$Mode]
$tabs = @()

# API: keep it only if it is ours and already on the right database.
$apiOk = (Test-OwnTab $apiPort) -and ((Get-ApiDatabase $apiPort) -eq $wantedDb)
if (-not $apiOk) {
  [void](Stop-Port $apiPort)
  Stop-StrayApiServers
  $title = "Flourish API - $Mode ($wantedDb) :$apiPort"
  $tabs += "new-tab --title `"$title`" --suppressApplicationTitle -d `"$root\server`" cmd /k `"set FLOURISH_TAB=API&& npm run $($scripts[$Mode])`""
}

# Metro: keep it only if it runs in our visible tab.
$metroOk = Test-OwnTab $metroPort
if (-not $metroOk) {
  [void](Stop-Port $metroPort)
  $title = "Flourish Metro :$metroPort"
  $tabs += "new-tab --title `"$title`" --suppressApplicationTitle -d `"$root\app`" cmd /k `"set FLOURISH_TAB=METRO&& npm start`""
}

if ($tabs.Count -gt 0) {
  # One named window ("flourish"), so every run reuses the same place.
  Start-Process wt.exe -ArgumentList ("-w flourish " + ($tabs -join ' ; '))
}

if (-not (Wait-Port $apiPort 60)) { Write-Host "API did not start on :$apiPort - check its tab." }
if (-not (Wait-Port $metroPort 60)) { Write-Host "Metro did not start on :$metroPort - check its tab." }

# A restarted Metro or API means the running app points at stale state:
# restart the app so it reconnects to both.
if ($tabs.Count -gt 0) {
  $serial = adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' } |
    Select-Object -First 1 | ForEach-Object { ($_ -split "`t")[0] }
  if ($serial) {
    $installed = adb -s $serial shell pm list packages com.app | Select-String 'package:com.app$'
    if ($installed) {
      adb -s $serial shell am force-stop com.app | Out-Null
      adb -s $serial shell am start -n com.app/.MainActivity | Out-Null
      Write-Host "Restarted the app on $serial."
    } else {
      Write-Host "The app is not installed on $serial - run npm run android:app-only in app/ first."
    }
  }
}

Show-Status
