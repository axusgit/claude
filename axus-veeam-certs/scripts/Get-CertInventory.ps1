<#
.SYNOPSIS
  READ-ONLY inventory for the Veeam cert-renewal project. Changes nothing on the server.
  Run via: az vm run-command invoke ... --command-id RunPowerShellScript --scripts @scripts/Get-CertInventory.ps1
  Output is kept compact because run-command returns only ~4 KB.
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', 'buf', Justification = 'Used across Begin/Process/End blocks.')]
param()
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
function Out-Line($k, $v) { Write-Output ("{0}: {1}" -f $k, $v) }

# --- OS / runtime ---
$os = Get-CimInstance Win32_OperatingSystem
Out-Line 'HOST' "$env:COMPUTERNAME | $($os.Caption) | build $($os.BuildNumber) | boot $($os.LastBootUpTime.ToString('yyyy-MM-dd'))"
$net = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release
Out-Line 'PS' "WinPS $($PSVersionTable.PSVersion) | .NET4 release $net"
$pwsh = Get-Command pwsh.exe
if (-not $pwsh) { $pwsh = Get-Item "$env:ProgramFiles\PowerShell\7\pwsh.exe" }
Out-Line 'PWSH' $(if ($pwsh) { "$($pwsh.Source)$($pwsh.FullName) v$((Get-Item ($pwsh.Source + $pwsh.FullName)).VersionInfo.ProductVersion)" } else { 'not installed' })
$pg = (Get-Module PowerShellGet -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1).Version
$nuget = (Get-PackageProvider -ListAvailable -Name NuGet | Select-Object -First 1).Version
$pa = Get-Module Posh-ACME -ListAvailable | Select-Object -First 1
Out-Line 'MODULES' "PowerShellGet $pg | NuGet provider $(if($nuget){$nuget}else{'none'}) | Posh-ACME $(if($pa){$pa.Version}else{'none'})"

# --- Veeam products ---
$uk = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $uk | Where-Object { $_.DisplayName -match 'Veeam (Backup & Replication Server|Service Provider Console|Cloud Connect|Management Portal)|Veeam Backup & Replication Console' } |
  Sort-Object DisplayName -Unique | ForEach-Object { Out-Line 'VEEAM' "$($_.DisplayName) $($_.DisplayVersion)" }
Get-Service 'Veeam*' | Sort-Object Name | ForEach-Object { "SVC: $($_.Name) [$($_.Status)/$($_.StartType)] $($_.DisplayName)" }

# --- Certificates in LocalMachine\My ---
# Self-signed / internal certs are summarized as a count to stay under the output cap.
$all = Get-ChildItem Cert:\LocalMachine\My
$internal = $all | Where-Object { $_.Issuer -match "CN=($env:COMPUTERNAME|Veeam Software|Veeam Backup Server Certificate)(,|$)|Windows Azure CRP" }
Out-Line 'CERTS-INTERNAL' "$(@($internal).Count) self-signed/Veeam/Azure-CRP certs not listed (of $(@($all).Count) total)"
$all | Where-Object { $internal.Thumbprint -notcontains $_.Thumbprint } | Sort-Object NotAfter | ForEach-Object {
  $iss = if ($_.Issuer -match 'CN=([^,]+)') { $Matches[1] } else { $_.Issuer }
  $san = ($_.DnsNameList.Unicode | Select-Object -First 3) -join ','
  $alg = $_.PublicKey.Oid.FriendlyName; $len = $_.PublicKey.Key.KeySize
  "CERT: $($_.Thumbprint) | $($_.NotAfter.ToString('yyyy-MM-dd')) | key=$($_.HasPrivateKey) $alg$len | iss=$iss | san=$san"
}

# --- HTTP.sys SSL bindings (port -> cert hash) ---
netsh http show sslcert | Select-String 'IP:port|Hostname:port|Certificate Hash|Application ID' | ForEach-Object { $_.Line.Trim() -replace '\s{2,}', ' ' } |
  ForEach-Object -Begin { $buf = @() } -Process {
    if ($_ -match '^(IP|Hostname):port') { if ($buf) { "SSL: " + ($buf -join ' | ') }; $buf = @($_ -replace '^.*: ', '') } else { $buf += ($_ -replace '^.*: ', '') }
  } -End { if ($buf) { "SSL: " + ($buf -join ' | ') } }

# --- IIS (VSPC web UI) ---
if (Get-Module WebAdministration -ListAvailable) {
  Import-Module WebAdministration
  Get-Website | ForEach-Object {
    $b = ($_.Bindings.Collection | ForEach-Object { "$($_.protocol)/$($_.bindingInformation)$(if($_.certificateHash){'#'+$_.certificateHash.Substring(0,8)})" }) -join ' '
    "IIS: $($_.Name) [$($_.State)] $b"
  }
} else { Out-Line 'IIS' 'not installed' }

# --- VSPC "Server" certificate role (registry) + Veeam listening ports ---
$vac = Get-ItemProperty 'HKLM:\SOFTWARE\Veeam\VAC'
if ($vac.ServerCommunicationCertificate) { Out-Line 'VSPC-SERVER-CERT' $vac.ServerCommunicationCertificate }
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 1280, 1989, 6180, 9999 | ForEach-Object {
  "LISTEN: $($_.LocalPort) $((Get-Process -Id $_.OwningProcess).ProcessName)" } | Sort-Object -Unique

# --- VBR Cloud Connect (read-only Get-* cmdlets, VBR 13 uses PowerShell 7) ---
if ($pwsh -and (Get-Service VeeamBackupSvc)) {
  $exe = "$($pwsh.Source)$($pwsh.FullName)"
  & $exe -NoProfile -NonInteractive -Command {
    $ErrorActionPreference = 'Stop'
    try {
      Import-Module Veeam.Backup.PowerShell -DisableNameChecking
      $c = Get-VBRCloudGatewayCertificate
      $c | Select-Object -First 1 | ForEach-Object { "GWCERT: $($_.Thumbprint) | $($_.NotAfter) | $($_.SubjectName)$($_.Subject)" }
      Get-VBRCloudGateway | ForEach-Object { "GW: $($_.Name) | enabled=$($_.Enabled) | port=$($_.NetworkMode)$($_.IpAddress):$($_.Port)" }
      "TENANTS: $(@(Get-VBRCloudTenant).Count)"
    } catch { "VBRPS-ERR: $($_.Exception.Message)" }
  } 2>&1 | Select-Object -First 15
}

# --- Outbound reachability needed by ACME + managed identity ---
foreach ($t in 'acme-v02.api.letsencrypt.org', 'acme-staging-v02.api.letsencrypt.org', 'management.azure.com') {
  $r = Test-NetConnection $t -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
  Out-Line 'NET' "${t}:443 = $r"
}
$imds = try { (Invoke-WebRequest 'http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text' -Headers @{Metadata = 'true' } -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "fail $($_.Exception.Message)" }
Out-Line 'IMDS' $imds
