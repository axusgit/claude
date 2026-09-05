# Builds the collector and probe binaries into .\bin
# Uses the portable Go SDK if `go` is not already on PATH.

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

Write-Host "Building collector..." -ForegroundColor Cyan
& $go build -o .\bin\collector.exe .\cmd\collector
if ($LASTEXITCODE -ne 0) { throw "collector build failed" }

Write-Host "Building probe (single .exe)..." -ForegroundColor Cyan
& $go build -o .\bin\probe.exe .\cmd\probe
if ($LASTEXITCODE -ne 0) { throw "probe build failed" }

Write-Host "Done. Binaries in .\bin" -ForegroundColor Green
Get-ChildItem .\bin\*.exe | Select-Object Name, @{n="MB";e={[math]::Round($_.Length/1MB,1)}}
