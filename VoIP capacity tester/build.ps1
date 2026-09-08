# Builds the collector, the console probe, and the GUI probe into .\bin
# Uses the portable Go SDK if `go` is not already on PATH.
#
# Optionally bake a collector URL into the probes so a technician only needs a
# CODE (no -server flag / no editing the field):
#
#   powershell -ExecutionPolicy Bypass -File .\build.ps1 -Server https://voiptest.axustechnologies.com
#
# Optionally Authenticode-SIGN the two probe .exes to clear the Windows
# SmartScreen warning (needs a code-signing cert — see SIGNING.md). Either pass a
# PFX file, or a cert thumbprint already installed in the Windows cert store
# (typical for an EV cert on a token):
#
#   ... -Pfx C:\path\axus-cs.pfx -PfxPassword 'secret'
#   ... -CertThumbprint 1A2B3C...   (EV token / installed cert)
#
# Signing happens AFTER the build so the collector serves already-signed probes
# (it then auto-detects the signature and won't corrupt it with a config trailer).

param(
    [string]$Server = "",
    [string]$Pfx = "",
    [string]$PfxPassword = "",
    [string]$CertThumbprint = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

# Locate signtool.exe (Windows SDK). Returns $null if not installed.
function Find-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $hits = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "x64" } | Sort-Object FullName -Descending
    if ($hits) { return $hits[0].FullName }
    return $null
}

function Sign-File($path) {
    if ($Pfx -eq "" -and $CertThumbprint -eq "") { return }  # signing not requested
    $st = Find-SignTool
    if (-not $st) { throw "signing requested but signtool.exe not found (install the Windows SDK)" }
    $args = @("sign", "/fd", "SHA256", "/tr", $TimestampUrl, "/td", "SHA256")
    if ($Pfx -ne "") {
        $args += @("/f", $Pfx)
        if ($PfxPassword -ne "") { $args += @("/p", $PfxPassword) }
    } else {
        $args += @("/sha1", $CertThumbprint)
    }
    $args += $path
    Write-Host "Signing $path ..." -ForegroundColor Magenta
    & $st @args
    if ($LASTEXITCODE -ne 0) { throw "signtool failed on $path" }
}

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

# Sign the Windows probes (no-op unless a cert was passed). The collector on Linux
# is never signed. Signed probes -> the collector serves them byte-for-byte and
# the CODE travels in the download filename.
Sign-File ".\bin\voiptesterprobe.exe"
Sign-File ".\bin\voiptesterprobe-cli.exe"

Write-Host "Done. Binaries in .\bin" -ForegroundColor Green
Get-ChildItem .\bin\*.exe | Select-Object Name, @{n="MB";e={[math]::Round($_.Length/1MB,1)}}
