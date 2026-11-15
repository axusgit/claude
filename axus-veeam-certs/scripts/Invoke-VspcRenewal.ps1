#Requires -Version 5.1
<#
.SYNOPSIS
  VSPC (vspc.axusbackups.com): renew the Let's Encrypt certificate into LocalMachine\My and,
  when allowed, bind it to the VSPC Web UI (IIS site on :1280).

  Binding = swap the certificate on the HTTP.sys SSL binding 0.0.0.0:1280 (all other settings
  copied), restart the Web UI IIS site, verify the served cert, automatic rollback on failure.
  Veeam documents the console wizard and IIS Manager bindings for the Web UI certificate:
  https://helpcenter.veeam.com/docs/vac/provider_admin/configure_web_ui_certificate.html
  The VSPC Server certificate (Veeam self-signed, valid to 2033) is not touched.

.PARAMETER Environment
  Staging or Production. REQUIRED. Nothing defaults to production.

.PARAMETER NewOrder
  First issuance only. Creates the ACME account (if missing) and the order.

.PARAMETER AutoBind
  Bind the newest Let's Encrypt cert automatically, but ONLY when the Web UI already uses a
  Let's Encrypt cert, the new one expires later, and the time is inside BindWindow
  (config.json, default 01:00-05:00 server time). Used by the daily scheduled task.

.PARAMETER BindThumbprint / AllowSwitchFromNonLE
  Manual, human-approved bind of a specific cert (the first switch away from Sectigo).

.EXAMPLE  Staging pass (no install, no bind):
  powershell -File Invoke-VspcRenewal.ps1 -Environment Staging -NewOrder
.EXAMPLE  First production switch, in an approved window:
  powershell -File Invoke-VspcRenewal.ps1 -Environment Production -BindThumbprint <tp> -AllowSwitchFromNonLE
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Staging', 'Production')][string]$Environment,
    [switch]$NewOrder,
    [switch]$ForceRenew,
    [switch]$AutoBind,
    [string]$BindThumbprint,
    [string]$BindServerThumbprint,
    [switch]$AllowSwitchFromNonLE,
    [string]$ConfigPath = 'C:\ProgramData\Axus\CertRenewal\config.json'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AxusCertRenewal.psm1') -Force

$log = Initialize-CRLog -Name 'vspc'
$cfg = $null
$status = @{ Role = 'VSPC'; Environment = $Environment; Result = 'Unknown' }
$exit = 0
try {
    $cfg = Get-CRConfig -Path $ConfigPath
    if ($cfg.Role -ne 'VSPC') { throw "This server is configured as $($cfg.Role), not VSPC." }
    $domain = $cfg.Domain
    $warnDays = [int](Get-CRConfigValue $cfg 'WarnDays' 21)
    $port = [int](Get-CRConfigValue $cfg 'WebUiPort' 1280)
    $window = Get-CRConfigValue $cfg 'BindWindow' '01:00-05:00'
    $site = Get-CRConfigValue $cfg 'WebUiSiteName' $null
    Write-CRLog "Start VSPC $Environment domain=$domain newOrder=$NewOrder autoBind=$AutoBind bindTp=$BindThumbprint" -Summary

    if (($BindThumbprint -or $BindServerThumbprint) -and $Environment -ne 'Production') { throw 'Binding is only possible with -Environment Production.' }
    $manual = [bool]($BindThumbprint -or $BindServerThumbprint)
    if ($AutoBind -and $Environment -ne 'Production') { throw '-AutoBind is only valid with -Environment Production.' }

    $bindArgs = @{ Domain = $domain; Port = $port; Confirm = $false }
    if ($site) { $bindArgs.SiteName = $site }

    if ($BindServerThumbprint) {
        $status.Action = 'ManualServerBind'
        $status.ServerBound = Set-CRVspcServerCertificate -Thumbprint $BindServerThumbprint -Domain $domain -AllowSwitchFromNonLE:$AllowSwitchFromNonLE -Confirm:$false
        if ($status.ServerBound) {
            Send-CRNotification -Config $cfg -Severity Information -Subject "VSPC Server certificate installed ($domain)" -Body (
                "Cert $($BindServerThumbprint.ToUpper()) is now the VSPC Server certificate (management agents); agents reconnected.`r`nLog: $log") | Out-Null
        }
    } elseif ($BindThumbprint) {
        $status.Action = 'ManualBind'
        $status.Bound = Set-CRVspcWebUiCertificate @bindArgs -Thumbprint $BindThumbprint -AllowSwitchFromNonLE:$AllowSwitchFromNonLE
        if ($status.Bound) {
            Send-CRNotification -Config $cfg -Severity Information -Subject "VSPC Web UI certificate bound ($domain)" -Body (
                "Cert $($BindThumbprint.ToUpper()) is now served on port $port.`r`nVerify: log in to the portal, management agents Healthy. Log: $log") | Out-Null
        }
    } else {
        Initialize-CRAcme -Environment $Environment -AllowNewAccount:$NewOrder | Out-Null
        $r = Invoke-CRCertificate -Domain $domain -Environment $Environment -NewOrder:$NewOrder -ForceRenew:$ForceRenew
        $status.Action = $r.Action; $status.AcmeThumbprint = $r.Thumbprint; $status.AcmeNotAfter = "$($r.NotAfter)"
    }

    if ($Environment -eq 'Production') {
        $webTp = Get-CRVspcWebUiThumbprint -Port $port
        $web = Get-CRStoreCertificate -Thumbprint $webTp
        $webIsLE = Test-CRIsLetsEncryptProd $web
        $apiOk = Test-CRVspcApiConfigured
        $newTp = $null; $newCert = $null

        if (-not $manual) {
            $newTp = "$($r.Thumbprint)".ToUpper()
            $newCert = if ($newTp) { Get-CRStoreCertificate -Thumbprint $newTp } else { $null }
            # Pending: a newer prod LE cert is installed but the Web UI still uses something else.
            $pending = $newCert -and ($newTp -ne $webTp) -and (-not $web -or $newCert.NotAfter -gt $web.NotAfter -or -not $webIsLE)

            if ($pending -and $AutoBind -and $webIsLE) {
                if (Test-CRInWindow -Window $window) {
                    $status.Bound = Set-CRVspcWebUiCertificate @bindArgs -Thumbprint $newTp
                    $pending = $false
                } else {
                    Write-CRLog "New cert $newTp ready; outside bind window $window, bind deferred to the next run inside the window." -Level WARN
                    $status.BindDeferred = $true
                    $pending = $false   # the expiry guard below still alerts if this never happens
                }
            }

            $status.BindPending = [bool]$pending
            if ($pending -and ($r.Action -ne 'NotDue' -or (Get-CRConfigValue $cfg 'RemindDaily' $true))) {
                $why = if (-not $webIsLE) { 'The Web UI still uses a non-Let''s Encrypt cert; the first switch is done by hand (once).' } else { 'Automatic bind is not enabled on this run.' }
                $body = @(
                    "A new Let's Encrypt certificate is installed on $env:COMPUTERNAME and is waiting to be bound."
                    $why
                    ''
                    "  New cert : $newTp  (expires $($newCert.NotAfter))"
                    "  Web UI   : $webTp  (expires $(if($web){$web.NotAfter}else{'unknown'}))"
                    ''
                    'Bind it in a quiet window: RUNBOOK section 5a (one command via run-command), or in the console:'
                    '  Configuration > Certificates > Install > Web UI > pick the cert above, then restart the IIS site.'
                    ''
                    "Log: $log"
                ) -join "`r`n"
                Send-CRNotification -Config $cfg -Severity Warning -Subject "VSPC: new certificate ready to bind ($domain)" -Body $body | Out-Null
                Write-CRLog "Bind pending: $newTp (Web UI uses $webTp). Notification sent." -Level WARN
            }
        }

        # Expiry guard on whatever the Web UI actually uses (re-read after any bind).
        $webTp = Get-CRVspcWebUiThumbprint -Port $port
        $web = Get-CRStoreCertificate -Thumbprint $webTp
        $status.WebUiThumbprint = $webTp
        if ($web) {
            $days = Get-CRDaysLeft -NotAfter $web.NotAfter
            $status.WebUiNotAfter = "$($web.NotAfter)"; $status.WebUiDaysLeft = $days
            Write-CRLog "Web UI cert $webTp expires $($web.NotAfter) ($days days)" -Summary
            if ($days -lt $warnDays) {
                $sev = if ($days -lt 7) { 'Error' } else { 'Warning' }
                Send-CRNotification -Config $cfg -Severity $sev -Subject "VSPC Web UI cert expires in $days days ($domain)" -Body (
                    "Web UI cert $webTp expires $($web.NotAfter). Automatic renewal/bind has not replaced it.`r`n" +
                    "See docs/RUNBOOK.md 'When a renewal fails'. Log: $log") | Out-Null
            }
        }

        # VSPC Server certificate (management agents). Never fatal for the rest of the run.
        $srvTp = $null; $srv = $null
        try {
            if ($apiOk) {
                $srvTp = Get-CRVspcServerCertThumbprint -Retries 3
                Set-CRVspcKnownServerThumbprint -Thumbprint $srvTp
            } else {
                $srvTp = Get-CRVspcKnownServerThumbprint
                Write-CRLog "VSPC API key not configured: Server cert not installed automatically; last known Server cert: $srvTp" -Level WARN
            }
            if ($srvTp) { $srv = Get-CRStoreCertificate -Thumbprint $srvTp }
            $srvIsLE = Test-CRIsLetsEncryptProd $srv
            if (-not $manual -and $newCert -and $srvTp) {
                $srvPending = ($newTp -ne $srvTp) -and (-not $srv -or $newCert.NotAfter -gt $srv.NotAfter -or -not $srvIsLE)
                if ($srvPending -and $apiOk -and $AutoBind -and $srvIsLE) {
                    if (Test-CRInWindow -Window $window) {
                        $status.ServerBound = Set-CRVspcServerCertificate -Thumbprint $newTp -Domain $domain -Confirm:$false
                    } else {
                        Write-CRLog "Server cert: new cert $newTp ready; outside bind window $window, deferred." -Level WARN
                        $status.ServerDeferred = $true
                    }
                } elseif ($srvPending) {
                    $status.ServerPending = $true
                    Write-CRLog "Server cert pending: $newTp (Server uses $srvTp)." -Level WARN
                    if ($r.Action -ne 'NotDue' -or (Get-CRConfigValue $cfg 'RemindDaily' $true)) {
                        Send-CRNotification -Config $cfg -Severity Warning -Subject "VSPC: install the new Server certificate (management agents) ($domain)" -Body (@(
                                "A newer Let's Encrypt certificate is installed on $env:COMPUTERNAME but the VSPC Server certificate (used by management agents) is still the old one."
                                ''
                                "  New cert    : $newTp (expires $($newCert.NotAfter))"
                                "  Server cert : $srvTp (expires $(if ($srv) { $srv.NotAfter } else { 'unknown' }))"
                                ''
                                'Install it (about 5 minutes, agents reconnect by themselves):'
                                '  1. VSPC console > Configuration > Certificates > Install > Server.'
                                "  2. Select the certificate from the store: 'LetsEncrypt $domain' with the latest expiry date. Finish."
                                '  3. Restart the "Veeam Management Portal" service on the VSPC server (or have it done via run-command).'
                                '  4. Log in again; check management agents are Healthy.'
                                ''
                                "Log: $log"
                            ) -join "`r`n") | Out-Null
                    }
                }
                if ($status['ServerBound']) { $srvTp = Get-CRVspcKnownServerThumbprint; $srv = Get-CRStoreCertificate -Thumbprint $srvTp }
            }
            $status.ServerThumbprint = $srvTp
            if ($srv) {
                $sdays = Get-CRDaysLeft -NotAfter $srv.NotAfter
                $status.ServerNotAfter = "$($srv.NotAfter)"; $status.ServerDaysLeft = $sdays
                Write-CRLog "Server cert $srvTp expires $($srv.NotAfter) ($sdays days)" -Summary
                if ($sdays -lt $warnDays) {
                    $sev = if ($sdays -lt 7) { 'Error' } else { 'Warning' }
                    Send-CRNotification -Config $cfg -Severity $sev -Subject "VSPC Server cert (management agents) expires in $sdays days ($domain)" -Body (
                        "Server cert $srvTp expires $($srv.NotAfter). Management agents lose their connection when it expires.`r`n" +
                        "Install the newest 'LetsEncrypt $domain' cert: Configuration > Certificates > Install > Server, then restart Veeam Management Portal. Log: $log") | Out-Null
                }
            } elseif (-not $srvTp) {
                Write-CRLog 'Server cert unknown (no API key and no recorded thumbprint).' -Level WARN
            }
        } catch {
            $status.ServerError = $_.Exception.Message
            Write-CRLog "Server certificate step failed: $($_.Exception.Message)" -Level ERROR
            Send-CRNotification -Config $cfg -Severity Error -Subject "VSPC Server certificate step FAILED ($domain)" -Body "$($_.Exception.Message)`r`n`r`nThe Web UI part of this run is unaffected. Log: $log" | Out-Null
        }

        # One e-mail for every renewal (and for a catch-up bind), saying what is now in use.
        if ($status['Action'] -in 'Issued', 'Renewed' -or (-not $manual -and ($status['Bound'] -or $status['ServerBound']))) {
            $bindLine = if ($status['Bound']) { "Bound to the Web UI (port $port) and verified." }
            elseif ($status['BindDeferred']) { "Not bound yet: binds automatically on the next run inside the bind window ($window)." }
            elseif ($status['BindPending']) { 'Waiting to be bound (see the separate "ready to bind" e-mail).' }
            else { 'Not bound (automatic bind is off for this run).' }
            $srvLine = if ($status['ServerPending'] -and -not $apiOk) { 'Server certificate (management agents): NEEDS MANUAL INSTALL (see the separate e-mail).' }
            elseif (-not $apiOk) { 'Server certificate (management agents): installed manually (no API key).' }
            elseif ($status['ServerBound']) { 'Server certificate (management agents): installed, agents reconnected.' }
            elseif ($status['ServerDeferred']) { "Server certificate: installs on the next run inside the bind window ($window)." }
            elseif ($status['ServerPending']) { 'Server certificate: waiting (first switch, or auto-bind off).' }
            else { 'Server certificate: unchanged.' }
            $subj = if ($status['Action'] -in 'Issued', 'Renewed') { "VSPC certificate renewed ($domain)" } else { "VSPC certificate bound ($domain)" }
            Send-CRNotification -Config $cfg -Severity Information -Subject $subj -Body (@(
                    $(if ($status['Action'] -in 'Issued', 'Renewed') { "New Let's Encrypt cert: $($status['AcmeThumbprint']) (expires $($status['AcmeNotAfter']))" })
                    $bindLine
                    "In use on the Web UI now: $webTp (expires $(if ($web) { $web.NotAfter } else { 'unknown' }))"
                    $srvLine
                    $(if ($status['ServerThumbprint']) { "Server certificate in use now: $($status['ServerThumbprint']) (expires $($status['ServerNotAfter']))" })
                    ''
                    "Log on $($env:COMPUTERNAME): $log"
                ) -join "`r`n") | Out-Null
        }
    }
    $status.Result = 'OK'
} catch {
    $exit = 1
    $status.Result = 'Error'; $status.Error = $_.Exception.Message
    Write-CRLog "FAILED: $($_.Exception.Message)" -Level ERROR
    Send-CRNotification -Config $cfg -Severity Error -Subject 'VSPC certificate renewal FAILED' -Body "$($_.Exception.Message)`r`n`r`nLog: $log" | Out-Null
} finally {
    Write-CRStatus -Name 'vspc' -Data $status | Out-Null
    Get-CRSummary | ForEach-Object { Write-Output $_ }
    Write-Output "Log: $log"
}
exit $exit
