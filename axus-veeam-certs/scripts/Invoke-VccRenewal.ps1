#Requires -Version 7.0
<#
.SYNOPSIS
  VCC (vcc.axusbackups.com): renew the Let's Encrypt certificate and, when allowed, bind it
  to the Veeam Cloud Connect gateways. Runs under PowerShell 7 (VBR 13 PowerShell module).

.PARAMETER Environment
  Staging or Production. REQUIRED. Nothing defaults to production.

.PARAMETER NewOrder
  First issuance only. Creates the ACME account (if missing) and the order.

.PARAMETER AutoBind
  Bind a newly renewed cert automatically, but ONLY when the gateway already uses a
  Let's Encrypt cert, the new one expires later, and the time is inside BindWindow
  (config.json, default 01:00-05:00 server time). Used by the daily scheduled task.

.PARAMETER BindThumbprint / AllowSwitchFromNonLE
  Manual, human-approved bind of a specific cert (the first switch away from Sectigo).

.EXAMPLE  Staging pass (no install, no bind):
  pwsh -File Invoke-VccRenewal.ps1 -Environment Staging -NewOrder
.EXAMPLE  First production switch, in an approved window:
  pwsh -File Invoke-VccRenewal.ps1 -Environment Production -BindThumbprint <tp> -AllowSwitchFromNonLE
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Staging', 'Production')][string]$Environment,
    [switch]$NewOrder,
    [switch]$ForceRenew,
    [switch]$AutoBind,
    [string]$BindThumbprint,
    [switch]$AllowSwitchFromNonLE,
    [string]$ConfigPath = 'C:\ProgramData\Axus\CertRenewal\config.json'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'AxusCertRenewal.psm1') -Force

$log = Initialize-CRLog -Name 'vcc'
$cfg = $null
$status = @{ Role = 'VCC'; Environment = $Environment; Result = 'Unknown' }
$exit = 0
try {
    $cfg = Get-CRConfig -Path $ConfigPath
    if ($cfg.Role -ne 'VCC') { throw "This server is configured as $($cfg.Role), not VCC." }
    $domain = $cfg.Domain
    $warnDays = [int](Get-CRConfigValue $cfg 'WarnDays' 21)
    $window = Get-CRConfigValue $cfg 'BindWindow' '01:00-05:00'
    Write-CRLog "Start VCC $Environment domain=$domain newOrder=$NewOrder autoBind=$AutoBind bindTp=$BindThumbprint" -Summary

    if ($BindThumbprint -and $Environment -ne 'Production') { throw 'Binding is only possible with -Environment Production.' }
    if ($AutoBind -and $Environment -ne 'Production') { throw '-AutoBind is only valid with -Environment Production.' }

    if (-not $BindThumbprint) {
        Initialize-CRAcme -Environment $Environment -AllowNewAccount:$NewOrder | Out-Null
        $r = Invoke-CRCertificate -Domain $domain -Environment $Environment -NewOrder:$NewOrder -ForceRenew:$ForceRenew
        $status.Action = $r.Action; $status.AcmeThumbprint = $r.Thumbprint; $status.AcmeNotAfter = "$($r.NotAfter)"

        if ($AutoBind -and $r.Action -ne 'NotDue') {
            if (Test-CRInWindow -Window $window) {
                $status.Bound = Set-CRVccCertificate -Thumbprint $r.Thumbprint -Domain $domain -Confirm:$false
            } else {
                Write-CRLog "Renewed outside bind window $window; bind deferred to the next run inside the window." -Level WARN
                $status.BindDeferred = $true
            }
        }
        if ($AutoBind -and $r.Action -eq 'NotDue') {
            # Catch up on a deferred bind: newest LE cert in the store not yet on the gateway.
            # Only once the gateway is already on Let's Encrypt (the first switch is always manual).
            $bt = "$((Get-CRVccBoundCertificate).Thumbprint)".ToUpper()
            $btIsLE = Test-CRIsLetsEncryptProd (Get-CRStoreCertificate -Thumbprint $bt)
            $acmeTp = "$($r.Thumbprint)".ToUpper()
            if ($btIsLE -and $acmeTp -and $acmeTp -ne $bt -and (Test-CRInWindow -Window $window) -and (Get-CRStoreCertificate -Thumbprint $acmeTp)) {
                Write-CRLog "Deferred bind pending for $acmeTp; binding now." -Summary
                $status.Bound = Set-CRVccCertificate -Thumbprint $acmeTp -Domain $domain -Confirm:$false
            }
        }
    } else {
        $status.Bound = Set-CRVccCertificate -Thumbprint $BindThumbprint -Domain $domain -AllowSwitchFromNonLE:$AllowSwitchFromNonLE -Confirm:$false
        $status.Action = 'ManualBind'
    }

    # Expiry guard on whatever the gateway is actually using.
    $cur = Get-CRVccBoundCertificate
    $curStore = Get-CRStoreCertificate -Thumbprint "$($cur.Thumbprint)"
    if ($curStore) {
        $days = Get-CRDaysLeft -NotAfter $curStore.NotAfter
        $status.BoundThumbprint = $curStore.Thumbprint; $status.BoundNotAfter = "$($curStore.NotAfter)"; $status.BoundDaysLeft = $days
        Write-CRLog "Gateway cert $($curStore.Thumbprint) expires $($curStore.NotAfter) ($days days)" -Summary
        if ($days -lt $warnDays) {
            $sev = if ($days -lt 7) { 'Error' } else { 'Warning' }
            Send-CRNotification -Config $cfg -Severity $sev -Subject "VCC gateway cert expires in $days days ($domain)" -Body (
                "Bound cert $($curStore.Thumbprint) expires $($curStore.NotAfter). Automatic renewal/bind has not replaced it.`r`n" +
                "See docs/RUNBOOK.md 'When a renewal fails'. Log: $log") | Out-Null
        }
    }

    # One e-mail for every renewal and every bind, saying what is now in use.
    if ($Environment -eq 'Production' -and ($status['Action'] -in 'Issued', 'Renewed' -or $status['Bound'])) {
        $bindLine = if ($status['Bound']) { 'Bound to the Cloud Connect gateways and verified. Confirm the next tenant backup job completes.' }
        elseif ($status['BindDeferred']) { "Not bound yet: binds automatically on the next run inside the bind window ($window)." }
        elseif ($AutoBind) { 'Not bound: the gateway does not use a Let''s Encrypt cert yet (first switch is manual).' }
        else { 'Not bound (automatic bind is off for this run).' }
        $subj = if ($status['Action'] -in 'Issued', 'Renewed') { "VCC certificate renewed ($domain)" } else { "VCC certificate bound ($domain)" }
        Send-CRNotification -Config $cfg -Severity Information -Subject $subj -Body (@(
                $(if ($status['Action'] -in 'Issued', 'Renewed') { "New Let's Encrypt cert: $($status['AcmeThumbprint']) (expires $($status['AcmeNotAfter']))" })
                $bindLine
                "In use on the gateway now: $($status['BoundThumbprint']) (expires $($status['BoundNotAfter']))"
                ''
                "Log on $($env:COMPUTERNAME): $log"
            ) -join "`r`n") | Out-Null
    }
    $status.Result = 'OK'
} catch {
    $exit = 1
    $status.Result = 'Error'; $status.Error = $_.Exception.Message
    Write-CRLog "FAILED: $($_.Exception.Message)" -Level ERROR
    Send-CRNotification -Config $cfg -Severity Error -Subject 'VCC certificate renewal FAILED' -Body "$($_.Exception.Message)`r`n`r`nLog: $log" | Out-Null
} finally {
    Write-CRStatus -Name 'vcc' -Data $status | Out-Null
    Get-CRSummary | ForEach-Object { Write-Output $_ }
    Write-Output "Log: $log"
}
exit $exit
