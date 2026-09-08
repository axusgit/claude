# Builds the collector, the console probe, and the GUI probe into .\bin
# Uses the portable Go SDK if `go` is not already on PATH.
#
# Optionally bake a collector URL into the probes so a technician only needs a
# CODE (no -server flag / no editing the field):
#
#   powershell -ExecutionPolicy Bypass -File .\build.ps1 -Server https://voiptest.axustechnologies.com

param(
    [string]$Server = ""
)

$ErrorActionPreference = "Stop"

$go = "go"
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    $portable = "C:\Users\Andy\sdk\go\bin\go.exe"
    if (Test-Path $portable) {
        $go = $portable
    } else {
        throw "Go not found on PATH and no portable SDK at $portable"
    }
}

New-Item -ItemType Directory -Force -Path .\bin | Out-Null

# ldflags: bake the server URL into the probes when -Server is given.
$serverX = ""
if ($Server -ne "") {
    $serverX = "-X main.defaultServer=$Server"
    Write-Host "Baking collector URL: $Server" -ForegroundColor DarkCyan
}

Write-Host "Building collector..." -ForegroundColor Cyan
& $go build -o .\bin\collector.exe .\cmd\collector
if ($LASTEXITCODE -ne 0) { throw "collector build failed" }

Write-Host "Building voiptesterprobe-cli (console .exe)..." -ForegroundColor Cyan
$cliArgs = @("build")
if ($serverX -ne "") { $cliArgs += @("-ldflags", $serverX) }
$cliArgs += @("-o", ".\bin\voiptesterprobe-cli.exe", ".\cmd\probe")
& $go @cliArgs
if ($LASTEXITCODE -ne 0) { throw "voiptesterprobe-cli build failed" }

# GUI probe (voiptesterprobe.exe): -H windowsgui suppresses the console window so
# it opens as a plain app. The manifest resource (rsrc_windows.syso) is picked up
# automatically.
Write-Host "Building voiptesterprobe (GUI .exe)..." -ForegroundColor Cyan
$guiLd = "-H windowsgui"
if ($serverX -ne "") { $guiLd = "$guiLd $serverX" }
& $go build -ldflags $guiLd -o .\bin\voiptesterprobe.exe .\cmd\probegui
if ($LASTEXITCODE -ne 0) { throw "voiptesterprobe build failed" }

Write-Host "Done. Binaries in .\bin" -ForegroundColor Green
Get-ChildItem .\bin\*.exe | Select-Object Name, @{n="MB";e={[math]::Round($_.Length/1MB,1)}}
