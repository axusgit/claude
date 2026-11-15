#Requires -Version 5.1
<#
.SYNOPSIS
  Registers (or removes) the daily SYSTEM scheduled task \Axus\CertRenewal on this server.
  CHANGES THE SERVER - needs explicit approval.

  VSPC: powershell.exe  ...\bin\Invoke-VspcRenewal.ps1 -Environment Production [-AutoBind]
  VCC : pwsh.exe        ...\bin\Invoke-VccRenewal.ps1  -Environment Production [-AutoBind]

  -Environment is mandatory (no default). Task runs daily at -At (server local time), retries
  twice 30 minutes apart on failure, 1 hour time limit, runs late if the server was off.

.EXAMPLE
  .\Register-CertRenewalTask.ps1 -Role VCC -Environment Production -At 02:17 -AutoBind
.EXAMPLE
  .\Register-CertRenewalTask.ps1 -Role VSPC -Unregister
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Register')]
param(
    [Parameter(Mandatory)][ValidateSet('VSPC', 'VCC')][string]$Role,
    [Parameter(Mandatory, ParameterSetName = 'Register')][ValidateSet('Staging', 'Production')][string]$Environment,
    [Parameter(ParameterSetName = 'Register')][ValidatePattern('^\d{2}:\d{2}$')][string]$At = '02:17',
    [Parameter(ParameterSetName = 'Register')][switch]$AutoBind,
    [Parameter(Mandatory, ParameterSetName = 'Unregister')][switch]$Unregister
)
$ErrorActionPreference = 'Stop'
$taskPath = '\Axus\'
$taskName = 'CertRenewal'
$bin = 'C:\ProgramData\Axus\CertRenewal\bin'

if ($Unregister) {
    if (Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue) {
        if ($PSCmdlet.ShouldProcess("$taskPath$taskName", 'Unregister')) {
            Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false
            "Removed $taskPath$taskName"
        }
    } else { "Task $taskPath$taskName not present" }
    return
}

if ($AutoBind -and $Environment -ne 'Production') { throw '-AutoBind requires -Environment Production.' }

if ($Role -eq 'VCC') {
    $exe = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
    if (-not (Test-Path $exe)) { throw "PowerShell 7 not found at $exe" }
    $script = Join-Path $bin 'Invoke-VccRenewal.ps1'
} else {
    $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $script = Join-Path $bin 'Invoke-VspcRenewal.ps1'
}
if (-not (Test-Path $script)) { throw "Missing $script. Run Initialize-CertRenewal.ps1 first." }

$arg = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -Environment $Environment"
if ($AutoBind) { $arg += ' -AutoBind' }

$action = New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory $bin
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$desc = "Axus: Let's Encrypt renewal for $Role ($Environment). See docs/RUNBOOK.md in axus-veeam-certs."

if ($PSCmdlet.ShouldProcess("$taskPath$taskName", "Register daily $At : $exe $arg")) {
    Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Description $desc -Force | Out-Null
    $t = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
    $i = $t | Get-ScheduledTaskInfo
    "Registered $taskPath$taskName state=$($t.State) next=$($i.NextRunTime)"
    "Action: $exe $arg"
}
