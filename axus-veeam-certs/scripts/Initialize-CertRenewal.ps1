#Requires -Version 5.1
<#
.SYNOPSIS
  One-time (idempotent) server setup for Let's Encrypt renewal. Run as SYSTEM via
  az vm run-command (Windows PowerShell 5.1). CHANGES THE SERVER - needs explicit approval.

  What it does:
   1. Creates C:\ProgramData\Axus\CertRenewal\{bin,logs} and C:\ProgramData\Posh-ACME,
      ACL = SYSTEM + Administrators only (inheritance removed).
   2. Sets machine environment variable POSHACME_HOME=C:\ProgramData\Posh-ACME.
   3. Installs the NuGet package provider (if missing) and Posh-ACME 4.35.0 for all users.
   4. Registers the Application event log source "AxusCertRenewal".
   5. Copies the renewal scripts from -SourceDir into ...\CertRenewal\bin.
   6. Writes ...\CertRenewal\config.json (no secrets: role, domain, notify addresses, window).
  It does NOT contact Let's Encrypt, create accounts/orders, bind, or restart anything.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][ValidateSet('VSPC', 'VCC')][string]$Role,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9.-]+\.[a-z]{2,}$')][string]$Domain,
    [Parameter(Mandatory)][string]$SourceDir,
    [string]$NotifyFrom,
    [string[]]$NotifyTo,
    [ValidatePattern('^\d{2}:\d{2}-\d{2}:\d{2}$')][string]$BindWindow = '01:00-05:00',
    [int]$WarnDays = 21
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\ProgramData\Axus\CertRenewal'
$paHome = 'C:\ProgramData\Posh-ACME'
$paVersion = '4.35.0'
$out = New-Object System.Collections.Generic.List[string]
function Note($m) { $out.Add($m); Write-Verbose $m }

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Must run elevated (run-command runs as SYSTEM).'
}

# 1. Folders + ACL (SYSTEM S-1-5-18, Administrators S-1-5-32-544)
foreach ($d in $root, (Join-Path $root 'bin'), (Join-Path $root 'logs'), $paHome) {
    if (-not (Test-Path $d)) { if ($PSCmdlet.ShouldProcess($d, 'Create folder')) { New-Item -ItemType Directory -Path $d -Force | Out-Null; Note "Created $d" } }
}
foreach ($d in $root, $paHome) {
    if ($PSCmdlet.ShouldProcess($d, 'Restrict ACL to SYSTEM + Administrators')) {
        # Protect the TOP folder only, then make everything below inherit from it.
        # (Never combine /inheritance:r with /T: on files the (OI)(CI) grant does not apply, which leaves
        #  files with an empty ACL that even SYSTEM cannot read. Happened on re-run 2026-11-14.)
        & icacls.exe $d /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "icacls failed on $d (exit $LASTEXITCODE)" }
        & icacls.exe $d /setowner '*S-1-5-32-544' /C /Q | Out-Null
        if (Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue) {
            & icacls.exe (Join-Path $d '*') /reset /T /C /Q | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "icacls /reset failed below $d (exit $LASTEXITCODE)" }
        }
        Note "ACL set on $d (SYSTEM, Administrators)"
    }
}

# 2. POSHACME_HOME (machine scope)
if ([Environment]::GetEnvironmentVariable('POSHACME_HOME', 'Machine') -ne $paHome) {
    if ($PSCmdlet.ShouldProcess('POSHACME_HOME', "Set machine env var to $paHome")) {
        [Environment]::SetEnvironmentVariable('POSHACME_HOME', $paHome, 'Machine'); Note "POSHACME_HOME=$paHome (machine)"
    }
}
$env:POSHACME_HOME = $paHome

# 3. NuGet provider + Posh-ACME
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue | Where-Object { $_.Version -ge [version]'2.8.5.201' })) {
    if ($PSCmdlet.ShouldProcess('NuGet provider', 'Install 2.8.5.201+ (AllUsers)')) {
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope AllUsers -Force | Out-Null; Note 'Installed NuGet provider'
    }
}
if (-not (Get-Module Posh-ACME -ListAvailable | Where-Object { $_.Version -eq [version]$paVersion })) {
    if ($PSCmdlet.ShouldProcess("Posh-ACME $paVersion", 'Install-Module -Scope AllUsers')) {
        Install-Module Posh-ACME -RequiredVersion $paVersion -Scope AllUsers -Repository PSGallery -Force -AllowClobber; Note "Installed Posh-ACME $paVersion"
    }
} else { Note "Posh-ACME $paVersion already installed" }

# 4. Event log source
if (-not [System.Diagnostics.EventLog]::SourceExists('AxusCertRenewal')) {
    if ($PSCmdlet.ShouldProcess('AxusCertRenewal', 'Register Application event source')) {
        New-EventLog -LogName Application -Source 'AxusCertRenewal'; Note 'Registered event source AxusCertRenewal'
    }
}

# 5. Scripts -> bin
$files = 'AxusCertRenewal.psm1', 'Invoke-VccRenewal.ps1', 'Invoke-VspcRenewal.ps1', 'Register-CertRenewalTask.ps1'
foreach ($f in $files) {
    $src = Join-Path $SourceDir $f
    if (-not (Test-Path $src)) { throw "Missing $src" }
    if ($PSCmdlet.ShouldProcess($f, 'Copy to bin')) { Copy-Item $src (Join-Path $root "bin\$f") -Force }
}
Note "Scripts copied to $root\bin"

# 6. config.json (non-secret)
$cfgPath = Join-Path $root 'config.json'
$cfg = [ordered]@{
    Role        = $Role
    Domain      = $Domain
    NotifyFrom  = $NotifyFrom
    NotifyTo    = @($NotifyTo | Where-Object { $_ })
    BindWindow  = $BindWindow
    WarnDays    = $WarnDays
    WebUiPort   = 1280
    RemindDaily = $true
}
if ($PSCmdlet.ShouldProcess($cfgPath, 'Write config')) { $cfg | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding UTF8; Note "Wrote $cfgPath" }

# Verification (read-only)
Import-Module (Join-Path $root 'bin\AxusCertRenewal.psm1') -Force
Note ("Managed identity token: {0}" -f $(if (Test-CRManagedIdentity) { 'OK' } else { 'NOT AVAILABLE (enable system-assigned identity)' }))
Note ("Posh-ACME loadable: {0}" -f $(try { Import-Module Posh-ACME -RequiredVersion $paVersion -ErrorAction Stop; 'yes' } catch { "NO: $($_.Exception.Message)" }))
if ($Role -eq 'VCC') {
    $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
    if (-not (Test-Path $pwsh)) { Note 'WARNING: PowerShell 7 not found; VCC renewal needs it.' }
    else {
        $chk = & $pwsh -NoProfile -NonInteractive -Command "Import-Module Posh-ACME -RequiredVersion $paVersion; Import-Module Veeam.Backup.PowerShell -DisableNameChecking; 'pwsh: Posh-ACME + Veeam module OK'" 2>&1
        Note "$chk"
    }
}
$out
