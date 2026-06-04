<#
.SYNOPSIS
  Boot the Axus Hub platform apps locally (hub, support, accounting) for dev.

.DESCRIPTION
  Each app runs from its own venv with AUTH_MODE=local, bound to 127.0.0.1.
  Support uses a local SQLite DB and gets `alembic upgrade head` before start.
  Accounting uses SQLite + create_all on startup. Hub needs no DB.

  Idempotent: if an app's port is already listening it is left alone (use
  -Restart to kill and relaunch). Logs go to each app's backend\_devrun.*.log.

.EXAMPLE
  .\start-local.ps1            # start whatever isn't already running
  .\start-local.ps1 -Restart   # stop those ports first, then start fresh
  .\start-local.ps1 -Stop      # just stop the dev servers and exit
#>
[CmdletBinding()]
param(
  [switch]$Restart,
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Definition

# app key -> port + whether it needs an alembic migration first
$apps = [ordered]@{
  hub        = @{ port = 8001; migrate = $false; sqlite = $null }
  support    = @{ port = 8000; migrate = $true;  sqlite = "sqlite:///./support_dev.db" }
  accounting = @{ port = 8002; migrate = $false; sqlite = $null }
}

function Get-PortPid([int]$Port) {
  (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
     Select-Object -First 1 -ExpandProperty OwningProcess)
}

function Stop-Port([int]$Port) {
  $procId = Get-PortPid $Port
  if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host "  stopped PID $procId on :$Port" -ForegroundColor Yellow }
}

if ($Stop) {
  Write-Host "Stopping Axus local dev servers..." -ForegroundColor Cyan
  foreach ($name in $apps.Keys) { Stop-Port $apps[$name].port }
  return
}

foreach ($name in $apps.Keys) {
  $cfg     = $apps[$name]
  $port    = $cfg.port
  $backend = Join-Path $repo "axus-hub\$name\backend"
  $py      = Join-Path $backend "venv\Scripts\python.exe"

  Write-Host "`n[$name] :$port" -ForegroundColor Cyan

  if (-not (Test-Path $py)) {
    Write-Host "  SKIP - no venv at $py" -ForegroundColor Red
    continue
  }

  $running = Get-PortPid $port
  if ($running -and -not $Restart) {
    Write-Host "  already running (PID $running) - skipping. Use -Restart to relaunch." -ForegroundColor DarkGray
    continue
  }
  if ($running -and $Restart) { Stop-Port $port; Start-Sleep -Milliseconds 500 }

  # per-app environment
  $env:AUTH_MODE = "local"
  $env:HOST      = "127.0.0.1"
  $env:PORT      = "$port"
  if ($cfg.sqlite) { $env:DATABASE_URL = $cfg.sqlite } else { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }

  if ($cfg.migrate) {
    Write-Host "  alembic upgrade head..." -ForegroundColor Gray
    # alembic.ini lives in the backend dir, so run from there. alembic logs to
    # stderr; under EAP=Stop that would abort the script, so send stderr to a
    # file and trust the exit code rather than parsing output.
    Push-Location $backend
    $errFile = Join-Path $backend "_alembic.err.log"
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $py -m alembic upgrade head 1>$null 2>$errFile
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    Pop-Location
    if ($code -eq 0) {
      Write-Host "  migrations OK" -ForegroundColor Green
    } else {
      Write-Host "  migration FAILED (exit $code) - see $errFile" -ForegroundColor Red
      Write-Host (Get-Content $errFile -Tail 5 | Out-String) -ForegroundColor Yellow
    }
  }

  Start-Process -FilePath $py -ArgumentList "run.py" -WorkingDirectory $backend `
    -RedirectStandardOutput (Join-Path $backend "_devrun.out.log") `
    -RedirectStandardError  (Join-Path $backend "_devrun.err.log") `
    -WindowStyle Hidden
  Write-Host "  launched" -ForegroundColor Green
}

# health check
Start-Sleep -Seconds 4
Write-Host "`n=== Health ===" -ForegroundColor Cyan
foreach ($name in $apps.Keys) {
  $port = $apps[$name].port
  try {
    $code = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5).StatusCode
    Write-Host ("  {0,-11} http://localhost:{1}  ->  {2}" -f $name, $port, $code) -ForegroundColor Green
  } catch {
    Write-Host ("  {0,-11} http://localhost:{1}  ->  DOWN ({2})" -f $name, $port, $_.Exception.Message) -ForegroundColor Red
  }
}
Write-Host "`nLogs: axus-hub\<app>\backend\_devrun.*.log   |   Stop all: .\start-local.ps1 -Stop" -ForegroundColor DarkGray
