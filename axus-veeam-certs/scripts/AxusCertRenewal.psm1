#Requires -Version 5.1
<#
.SYNOPSIS
  Shared logic for Let's Encrypt renewal on the Axus Veeam servers (VSPC + VCC).

  Design (see docs/RUNBOOK.md):
  - Posh-ACME, DNS-01 via the Azure plugin, authenticated with the VM's system-assigned
    managed identity (AZUseIMDS). No secrets are stored by these scripts.
  - The subscription ID is read at runtime from the Azure Instance Metadata Service; it is
    never written to disk by these scripts (Posh-ACME keeps it inside its own order data
    under POSHACME_HOME, which is ACL-restricted to SYSTEM + Administrators).
  - RSA 4096, Let's Encrypt "classic" profile, new key on every renewal.
  - Environment is ALWAYS explicit. Nothing defaults to production.
  - Existing (non-Let's Encrypt) certificates are never deleted or modified.
#>

Set-StrictMode -Version 2.0

# ----------------------------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------------------------
$script:PoshAcmeVersion = '4.35.0'
$script:Root            = 'C:\ProgramData\Axus\CertRenewal'
$script:PoshAcmeHome    = 'C:\ProgramData\Posh-ACME'
$script:EventSource     = 'AxusCertRenewal'
$script:ImdsBase        = 'http://169.254.169.254/metadata'
$script:LeProdIssuerRx  = "O=Let's Encrypt, "          # production intermediates (R10..R14, E5..E9, YR*)
$script:LeStageIssuerRx = '\(STAGING\)'
$script:Summary         = New-Object System.Collections.Generic.List[string]
$script:LogFile         = $null

# ----------------------------------------------------------------------------------------
# Logging + summary
# ----------------------------------------------------------------------------------------
function Get-CRRoot { $script:Root }

function Initialize-CRLog {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Name)
    $dir = Join-Path $script:Root 'logs'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $script:LogFile = Join-Path $dir ('{0}-{1}.log' -f $Name, (Get-Date -Format 'yyyyMMdd'))
    $script:Summary.Clear()
    $script:LogFile
}

function Write-CRLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO',
        [switch]$Summary
    )
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    if ($script:LogFile) { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 }
    Write-Verbose $line
    if ($Summary -or $Level -ne 'INFO') { $script:Summary.Add("[$Level] $Message") }
}

function Get-CRSummary { , $script:Summary.ToArray() }

# ----------------------------------------------------------------------------------------
# Config (non-secret, lives on the server only: C:\ProgramData\Axus\CertRenewal\config.json)
# ----------------------------------------------------------------------------------------
function Get-CRConfig {
    [CmdletBinding()]
    param([string]$Path = (Join-Path $script:Root 'config.json'))
    if (-not (Test-Path $Path)) { throw "Config not found: $Path. Run Initialize-CertRenewal.ps1 first." }
    $cfg = Get-Content $Path -Raw | ConvertFrom-Json
    foreach ($k in 'Role', 'Domain') {
        if (-not $cfg.PSObject.Properties[$k] -or [string]::IsNullOrWhiteSpace($cfg.$k)) { throw "Config is missing '$k'." }
    }
    if ($cfg.Role -notin 'VSPC', 'VCC') { throw "Config Role must be VSPC or VCC (got '$($cfg.Role)')." }
    $cfg
}

function Get-CRConfigValue {
    param($Config, [string]$Name, $Default)
    if ($Config -and $Config.PSObject.Properties[$Name] -and $null -ne $Config.$Name -and "$($Config.$Name)" -ne '') { $Config.$Name } else { $Default }
}

# ----------------------------------------------------------------------------------------
# Azure Instance Metadata Service (managed identity)
# ----------------------------------------------------------------------------------------
function Invoke-CRImds {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseSingularNouns', '', Justification = 'IMDS is an acronym, not a plural.')]
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)
    Invoke-RestMethod -Uri "$script:ImdsBase/$Path" -Headers @{ Metadata = 'true' } -UseBasicParsing -TimeoutSec 15
}

function Get-CRSubscriptionId {
    [CmdletBinding()]
    param()
    $id = Invoke-CRImds -Path 'instance/compute/subscriptionId?api-version=2021-02-01&format=text'
    if ("$id" -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Could not read subscription ID from IMDS.' }
    "$id"
}

function Get-CRManagedIdentityToken {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Resource)
    $r = Invoke-CRImds -Path ("identity/oauth2/token?api-version=2018-02-01&resource={0}" -f [uri]::EscapeDataString($Resource))
    if (-not $r.access_token) { throw "No managed identity token for $Resource. Is the system-assigned identity enabled?" }
    $r.access_token
}

function Test-CRManagedIdentity {
    [CmdletBinding()]
    param()
    try { [void](Get-CRManagedIdentityToken -Resource 'https://management.azure.com/'); $true } catch { $false }
}

# ----------------------------------------------------------------------------------------
# Posh-ACME
# ----------------------------------------------------------------------------------------
function Get-CRAcmeServerName {
    param([Parameter(Mandatory)][ValidateSet('Staging', 'Production')][string]$Environment)
    if ($Environment -eq 'Production') { 'LE_PROD' } else { 'LE_STAGE' }
}

function Initialize-CRAcme {
    <# Points Posh-ACME at the right home + ACME server. Creates an ACME account only if -AllowNewAccount. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('Staging', 'Production')][string]$Environment,
        [switch]$AllowNewAccount
    )
    $env:POSHACME_HOME = $script:PoshAcmeHome
    Import-Module Posh-ACME -RequiredVersion $script:PoshAcmeVersion -ErrorAction Stop
    $server = Get-CRAcmeServerName -Environment $Environment
    Set-PAServer -DirectoryUrl $server
    Write-CRLog "ACME server: $server ($Environment)"
    $acct = Get-PAAccount
    if (-not $acct) {
        if (-not $AllowNewAccount) { throw "No ACME account for $Environment. Run the first issue with -NewOrder." }
        # No contact address: Let's Encrypt no longer sends expiry mail; we monitor ourselves.
        $acct = New-PAAccount -AcceptTOS -ErrorAction Stop
        Write-CRLog "Created ACME account $($acct.id) on $server" -Summary
    }
    $acct
}

function Invoke-CRCertificate {
    <#
      -NewOrder : first issuance (creates the order).
      otherwise : Submit-Renewal, which only renews when the order is inside its renewal
                  window (ARI-suggested by Let's Encrypt), so running daily is safe.
      Returns a PSCustomObject: Action = Issued | Renewed | NotDue, plus cert details.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Domain,
        [Parameter(Mandatory)][ValidateSet('Staging', 'Production')][string]$Environment,
        [switch]$NewOrder,
        [switch]$ForceRenew
    )
    # Staging certs are never installed into the machine store, so they can never be bound by mistake.
    $install = ($Environment -eq 'Production')

    if ($NewOrder) {
        $existing = Get-PAOrder -MainDomain $Domain
        if ($existing) { throw "An order for $Domain already exists on $Environment. Use renewal (no -NewOrder) or -ForceRenew." }
        $pluginArgs = @{ AZSubscriptionId = (Get-CRSubscriptionId); AZUseIMDS = $true }
        $params = @{
            Domain        = $Domain
            Plugin        = 'Azure'
            PluginArgs    = $pluginArgs
            CertKeyLength = '4096'
            AlwaysNewKey  = $true
            Profile       = 'classic'
            FriendlyName  = "LetsEncrypt $Domain"
            Install       = $install
            AcceptTOS     = $true
            ErrorAction   = 'Stop'
        }
        Write-CRLog "Requesting NEW certificate for $Domain on $Environment (install=$install)" -Summary
        $cert = New-PACertificate @params
        $action = 'Issued'
    } else {
        $order = Get-PAOrder -MainDomain $Domain
        if (-not $order) { throw "No order for $Domain on $Environment. Run the first issue with -NewOrder." }
        Write-CRLog "Checking renewal for $Domain (renew after $($order.RenewAfter), force=$ForceRenew)"
        if ($ForceRenew) { $cert = Submit-Renewal -MainDomain $Domain -Force -ErrorAction Stop }
        else { $cert = Submit-Renewal -MainDomain $Domain -ErrorAction Stop }
        $action = if ($cert) { 'Renewed' } else { 'NotDue' }
    }

    if ($action -eq 'NotDue') {
        $cur = Get-PACertificate -MainDomain $Domain
        Write-CRLog "Not due. Current ACME cert $($cur.Thumbprint) expires $($cur.NotAfter)"
        return [pscustomobject]@{ Action = 'NotDue'; Thumbprint = $cur.Thumbprint; NotAfter = $cur.NotAfter; Installed = $install }
    }
    if (-not $cert) { throw "Posh-ACME returned no certificate for $Domain." }
    Write-CRLog "$action $Domain -> $($cert.Thumbprint), expires $($cert.NotAfter)" -Summary
    [pscustomobject]@{ Action = $action; Thumbprint = $cert.Thumbprint; NotAfter = $cert.NotAfter; Installed = $install }
}

# ----------------------------------------------------------------------------------------
# Certificate store helpers (read-only)
# ----------------------------------------------------------------------------------------
function Get-CRStoreCertificate {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Thumbprint)
    Get-Item -Path ("Cert:\LocalMachine\My\{0}" -f $Thumbprint.ToUpper()) -ErrorAction SilentlyContinue
}

function Test-CRIsLetsEncryptProd {
    param($Certificate)
    # Prod issuer looks like "CN=R12, O=Let's Encrypt, C=US"; staging is "O=(STAGING) Let's Encrypt".
    [bool]($Certificate -and "$($Certificate.Issuer)" -like "*$($script:LeProdIssuerRx)*" -and "$($Certificate.Issuer)" -notmatch $script:LeStageIssuerRx)
}

function Test-CRCertUsable {
    <# A cert we are willing to bind: prod LE, covers the domain, has private key, valid now, >= 7 days left. #>
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Certificate, [Parameter(Mandatory)][string]$Domain)
    $reasons = @()
    if (-not (Test-CRIsLetsEncryptProd $Certificate)) { $reasons += 'not a production Lets Encrypt cert' }
    if (@($Certificate.DnsNameList | ForEach-Object { "$($_.Unicode)" }) -notcontains $Domain) { $reasons += "SAN does not contain $Domain" }
    if (-not $Certificate.HasPrivateKey) { $reasons += 'no private key' }
    $now = Get-Date
    if ($Certificate.NotBefore -gt $now) { $reasons += 'not yet valid' }
    if ($Certificate.NotAfter -lt $now.AddDays(7)) { $reasons += 'expires within 7 days' }
    [pscustomobject]@{ Usable = ($reasons.Count -eq 0); Reasons = $reasons }
}

function Get-CRDaysLeft {
    param([Parameter(Mandatory)][datetime]$NotAfter)
    [int][math]::Floor(($NotAfter - (Get-Date)).TotalDays)
}

# ----------------------------------------------------------------------------------------
# Bind window (VCC auto-bind only happens inside it)
# ----------------------------------------------------------------------------------------
function Test-CRInWindow {
    <# Window like '01:00-05:00' in server local time. Supports windows crossing midnight. #>
    param([Parameter(Mandatory)][string]$Window, [datetime]$Now = (Get-Date))
    if ($Window -notmatch '^(\d{2}):(\d{2})-(\d{2}):(\d{2})$') { throw "Bad window format '$Window' (expected HH:mm-HH:mm)." }
    $s = [int]$Matches[1] * 60 + [int]$Matches[2]
    $e = [int]$Matches[3] * 60 + [int]$Matches[4]
    $n = $Now.Hour * 60 + $Now.Minute
    if ($s -le $e) { ($n -ge $s) -and ($n -lt $e) } else { ($n -ge $s) -or ($n -lt $e) }
}

# ----------------------------------------------------------------------------------------
# VCC (Veeam Cloud Connect gateway) - VBR 13 PowerShell module, PowerShell 7
# Cmdlets: https://helpcenter.veeam.com/docs/vbr/powershell/add-vbrcloudgatewaycertificate.html
# ----------------------------------------------------------------------------------------
function Import-CRVeeamModule {
    if (-not (Get-Command Get-VBRCloudGatewayCertificate -ErrorAction SilentlyContinue)) {
        Import-Module Veeam.Backup.PowerShell -DisableNameChecking -ErrorAction Stop
    }
}

function Get-CRVccBoundCertificate {
    [CmdletBinding()]
    param()
    Import-CRVeeamModule
    $c = Get-VBRCloudGatewayCertificate | Select-Object -First 1
    if (-not $c) { throw 'Get-VBRCloudGatewayCertificate returned nothing.' }
    $c
}

function Set-CRVccCertificate {
    <#
      Binds a certificate (already in LocalMachine\My) to the Cloud Connect gateways.
      Safety rules:
        - target must pass Test-CRCertUsable (prod LE, SAN, key, >= 7 days)
        - if the CURRENT cert is not Let's Encrypt (e.g. Sectigo), refuse unless -AllowSwitchFromNonLE
          (the first switch is a deliberate, human-approved action)
        - if the current cert IS Let's Encrypt, only bind a cert that expires later
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
    param(
        [Parameter(Mandatory)][string]$Thumbprint,
        [Parameter(Mandatory)][string]$Domain,
        [switch]$AllowSwitchFromNonLE
    )
    $Thumbprint = $Thumbprint.ToUpper()
    $target = Get-CRStoreCertificate -Thumbprint $Thumbprint
    if (-not $target) { throw "Certificate $Thumbprint is not in LocalMachine\My." }
    $check = Test-CRCertUsable -Certificate $target -Domain $Domain
    if (-not $check.Usable) { throw "Refusing to bind ${Thumbprint}: $($check.Reasons -join '; ')" }

    $bound = Get-CRVccBoundCertificate
    $boundTp = "$($bound.Thumbprint)".ToUpper()
    if ($boundTp -eq $Thumbprint) { Write-CRLog "VCC gateway already uses $Thumbprint" -Summary; return $false }

    $boundStore = Get-CRStoreCertificate -Thumbprint $boundTp
    $boundIsLE = Test-CRIsLetsEncryptProd $boundStore
    if (-not $boundIsLE -and -not $AllowSwitchFromNonLE) {
        throw "Current gateway cert $boundTp is not Let's Encrypt. First switch needs -AllowSwitchFromNonLE (human-approved)."
    }
    if ($boundIsLE -and $boundStore -and $target.NotAfter -le $boundStore.NotAfter) {
        throw "Target $Thumbprint does not expire later than bound $boundTp; not binding."
    }

    Import-CRVeeamModule
    $vbrCert = Get-VBRCloudGatewayCertificate -FromStore | Where-Object { "$($_.Thumbprint)".ToUpper() -eq $Thumbprint } | Select-Object -First 1
    if (-not $vbrCert) { throw "Get-VBRCloudGatewayCertificate -FromStore did not return $Thumbprint." }

    if ($PSCmdlet.ShouldProcess("Cloud Connect gateways", "Bind $Thumbprint (replacing $boundTp)")) {
        Write-CRLog "Binding $Thumbprint to Cloud Connect gateways (previous $boundTp)" -Summary
        Add-VBRCloudGatewayCertificate -Certificate $vbrCert -Confirm:$false -ErrorAction Stop | Out-Null
        $after = "$((Get-CRVccBoundCertificate).Thumbprint)".ToUpper()
        if ($after -ne $Thumbprint) { throw "Bind verification failed: gateway reports $after, expected $Thumbprint." }
        Write-CRLog "Bind verified: gateway now reports $after" -Summary
        return $true
    }
    $false
}

# ----------------------------------------------------------------------------------------
# VSPC Web UI (IIS site on :1280)
# Veeam's procedure: Configuration > Certificates > Install > Web UI, then restart the IIS site;
# Veeam also documents setting the binding in IIS Manager as an alternative:
# https://helpcenter.veeam.com/docs/vac/provider_admin/configure_web_ui_certificate.html
# Verified on axususeast2srv1 (2026-11-14): the Web UI thumbprint lives only in the HTTP.sys
# SSL binding 0.0.0.0:1280 (not in applicationHost.config, the VAC registry key or config files).
# Set-CRVspcWebUiCertificate swaps that binding's certificate (all other settings copied),
# restarts the site, checks the served cert, and rolls back automatically on any failure.
# ----------------------------------------------------------------------------------------
function Invoke-CRNetsh {
    <# Thin wrapper so tests can mock netsh. Returns output lines; throws on non-zero exit. #>
    param([Parameter(Mandatory)][string[]]$Arguments, [switch]$AllowFailure)
    $out = & netsh.exe @Arguments 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "netsh $($Arguments -join ' ') failed ($LASTEXITCODE): $($out -join ' ')" }
    , @($out)
}

function Get-CRSslBinding {
    <#
      Parses 'netsh http show sslcert ipport=0.0.0.0:<port>' into
      @{ Hash; AppId; Store; Settings = [ordered] name -> value } (main block only, before
      'Extended Properties'). Returns $null when there is no binding.
    #>
    [CmdletBinding()]
    param([int]$Port = 1280)
    $lines = Invoke-CRNetsh -Arguments @('http', 'show', 'sslcert', ("ipport=0.0.0.0:{0}" -f $Port)) -AllowFailure
    $settings = [ordered]@{}
    foreach ($l in $lines) {
        if ($l -match '^\s*Extended Properties') { break }
        if ($l -match '^\s*(\S.*?)\s+:\s(.*)$') { $settings[$Matches[1].Trim()] = $Matches[2].Trim() }
    }
    if (-not $settings.Contains('Certificate Hash')) { return $null }
    [pscustomobject]@{
        Port     = $Port
        Hash     = "$($settings['Certificate Hash'])".ToUpper()
        AppId    = $settings['Application ID']
        Store    = $settings['Certificate Store Name']
        Settings = $settings
    }
}

function Get-CRVspcWebUiThumbprint {
    [CmdletBinding()]
    param([int]$Port = 1280)
    $b = Get-CRSslBinding -Port $Port
    if (-not $b -or $b.Hash -notmatch '^[0-9A-F]{40}$') { throw "No HTTP.sys SSL binding found on 0.0.0.0:$Port." }
    $b.Hash
}

function Compare-CRSslSetting {
    <# Names of settings (other than the certificate hash) that differ between two bindings. #>
    param([Parameter(Mandatory)]$Before, [Parameter(Mandatory)]$After)
    $names = @($Before.Settings.Keys) + @($After.Settings.Keys) | Where-Object { $_ -ne 'Certificate Hash' } | Select-Object -Unique
    @($names | Where-Object { "$($Before.Settings[$_])" -ne "$($After.Settings[$_])" })
}

function Get-CRNetshUpdateArgument {
    <# Builds 'netsh http update sslcert' arguments that keep every setting of $Binding except the cert. #>
    param([Parameter(Mandatory)]$Binding, [Parameter(Mandatory)][string]$Thumbprint)
    $a = @('http', 'update', 'sslcert', ("ipport=0.0.0.0:{0}" -f $Binding.Port), "certhash=$($Thumbprint.ToLower())",
        "appid=$($Binding.AppId)", "certstorename=$(if ($Binding.Store) { $Binding.Store } else { 'MY' })")
    $flags = [ordered]@{
        'Verify Client Certificate Revocation'                   = 'verifyclientcertrevocation'
        'Verify Revocation Using Cached Client Certificate Only' = 'verifyrevocationwithcachedclientcertonly'
        'Usage Check'                                            = 'usagecheck'
        'DS Mapper Usage'                                        = 'dsmapperusage'
        'Negotiate Client Certificate'                           = 'clientcertnegotiation'
    }
    foreach ($k in $flags.Keys) {
        $v = $Binding.Settings[$k]
        if ($v -eq 'Enabled') { $a += "$($flags[$k])=enable" } elseif ($v -eq 'Disabled') { $a += "$($flags[$k])=disable" }
    }
    $nums = [ordered]@{ 'Revocation Freshness Time' = 'revocationfreshnesstime'; 'URL Retrieval Timeout' = 'urlretrievaltimeout' }
    # netsh rejects '=0' for these ('The parameter is incorrect', tested on Server 2022); 0 is the default anyway.
    foreach ($k in $nums.Keys) { $v = $Binding.Settings[$k]; if ($v -match '^\d+$' -and [int64]$v -gt 0) { $a += "$($nums[$k])=$v" } }
    , $a
}

function Get-CRVspcWebUiSiteName {
    <# The IIS site with an https binding on $Port (config WebUiSiteName overrides). #>
    param([int]$Port = 1280)
    Import-Module WebAdministration -ErrorAction Stop
    $sites = @(Get-Website | Where-Object { @($_.bindings.Collection | Where-Object { $_.protocol -eq 'https' -and $_.bindingInformation -like "*:$($Port):*" }).Count -gt 0 })
    if ($sites.Count -ne 1) { throw "Expected exactly one IIS site with https on port $Port, found $($sites.Count)." }
    $sites[0].Name
}

function Restart-CRWebSite {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Internal helper; only called inside the ShouldProcess-gated Set-CRVspcWebUiCertificate.')]
    param([Parameter(Mandatory)][string]$Name)
    Import-Module WebAdministration -ErrorAction Stop
    Stop-Website -Name $Name -ErrorAction Stop
    Start-Website -Name $Name -ErrorAction Stop
    for ($i = 0; $i -lt 15; $i++) {
        if ((Get-Website -Name $Name).State -eq 'Started') { return }
        Start-Sleep -Seconds 2
    }
    throw "IIS site '$Name' did not reach Started state."
}

function Get-CRServedThumbprint {
    <#
      TLS handshake to $Address:$Port with SNI $HostName; returns the thumbprint the server presents.
      Read-only: the validation callback accepts anything because we only record the cert.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$HostName, [int]$Port = 1280, [string]$Address = '127.0.0.1', [int]$TimeoutMs = 10000)
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $tcp.BeginConnect($Address, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { throw "TCP connect to ${Address}:$Port timed out." }
        $tcp.EndConnect($iar)
        $tcp.ReceiveTimeout = $TimeoutMs; $tcp.SendTimeout = $TimeoutMs
        $cb = [System.Net.Security.RemoteCertificateValidationCallback] { $true }
        $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, $cb)
        try {
            $ssl.AuthenticateAsClient($HostName)
            (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $ssl.RemoteCertificate).Thumbprint.ToUpper()
        } finally { $ssl.Dispose() }
    } finally { $tcp.Close() }
}

function Test-CRVspcWebUiServing {
    <# True when HTTP.sys holds $Thumbprint with unchanged settings and the site actually serves it. #>
    param([Parameter(Mandatory)][string]$Thumbprint, [Parameter(Mandatory)]$Before, [Parameter(Mandatory)][string]$HostName, [int]$Port = 1280)
    $after = Get-CRSslBinding -Port $Port
    if (-not $after) { Write-CRLog "Verify: no SSL binding on :$Port" -Level WARN; return $false }
    if ($after.Hash -ne $Thumbprint) { Write-CRLog "Verify: HTTP.sys has $($after.Hash), expected $Thumbprint" -Level WARN; return $false }
    $diff = @(Compare-CRSslSetting -Before $Before -After $after)
    if ($diff.Count) { Write-CRLog "Verify: binding settings changed: $($diff -join ', ')" -Level WARN; return $false }
    for ($i = 1; $i -le 5; $i++) {
        try {
            $served = Get-CRServedThumbprint -HostName $HostName -Port $Port
            if ($served -eq $Thumbprint) { return $true }
            Write-CRLog "Verify: site serves $served, expected $Thumbprint (try $i)" -Level WARN
        } catch { Write-CRLog "Verify: TLS probe failed (try $i): $($_.Exception.Message)" -Level WARN }
        Start-Sleep -Seconds 3
    }
    $false
}

function Set-CRVspcWebUiCertificate {
    <#
      Binds a certificate (already in LocalMachine\My) to the VSPC Web UI (HTTP.sys 0.0.0.0:<port>),
      restarts the Web UI IIS site, verifies, and ROLLS BACK to the previous cert on any failure.
      Safety rules (same as VCC):
        - target must pass Test-CRCertUsable (prod LE, SAN, key, >= 7 days)
        - if the CURRENT cert is not Let's Encrypt (e.g. Sectigo), refuse unless -AllowSwitchFromNonLE
        - if the current cert IS Let's Encrypt, only bind a cert that expires later
      Never deletes or modifies any certificate in the store.
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
    param(
        [Parameter(Mandatory)][string]$Thumbprint,
        [Parameter(Mandatory)][string]$Domain,
        [int]$Port = 1280,
        [string]$SiteName,
        [switch]$AllowSwitchFromNonLE
    )
    $Thumbprint = $Thumbprint.ToUpper()
    $target = Get-CRStoreCertificate -Thumbprint $Thumbprint
    if (-not $target) { throw "Certificate $Thumbprint is not in LocalMachine\My." }
    $check = Test-CRCertUsable -Certificate $target -Domain $Domain
    if (-not $check.Usable) { throw "Refusing to bind ${Thumbprint}: $($check.Reasons -join '; ')" }

    $before = Get-CRSslBinding -Port $Port
    if (-not $before) { throw "No HTTP.sys SSL binding on 0.0.0.0:$Port; not creating one." }
    $oldTp = $before.Hash
    if ($oldTp -eq $Thumbprint) { Write-CRLog "VSPC Web UI already uses $Thumbprint" -Summary; return $false }

    $oldStore = Get-CRStoreCertificate -Thumbprint $oldTp
    $oldIsLE = Test-CRIsLetsEncryptProd $oldStore
    if (-not $oldIsLE -and -not $AllowSwitchFromNonLE) {
        throw "Current Web UI cert $oldTp is not Let's Encrypt. First switch needs -AllowSwitchFromNonLE (human-approved)."
    }
    if ($oldIsLE -and $oldStore -and $target.NotAfter -le $oldStore.NotAfter) {
        throw "Target $Thumbprint does not expire later than bound $oldTp; not binding."
    }
    if (-not $SiteName) { $SiteName = Get-CRVspcWebUiSiteName -Port $Port }

    if (-not $PSCmdlet.ShouldProcess("VSPC Web UI :$Port ($SiteName)", "Bind $Thumbprint (replacing $oldTp)")) { return $false }

    Write-CRLog ("Before: " + (($before.Settings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '; '))
    Write-CRLog "Binding $Thumbprint to VSPC Web UI :$Port (previous $oldTp), then restarting site '$SiteName'" -Summary
    $failure = $null
    try {
        Invoke-CRNetsh -Arguments (Get-CRNetshUpdateArgument -Binding $before -Thumbprint $Thumbprint) | Out-Null
        Restart-CRWebSite -Name $SiteName
        if (-not (Test-CRVspcWebUiServing -Thumbprint $Thumbprint -Before $before -HostName $Domain -Port $Port)) { $failure = 'verification failed' }
    } catch { $failure = $_.Exception.Message }

    if (-not $failure) { Write-CRLog "Bind verified: Web UI serves $Thumbprint" -Summary; return $true }

    Write-CRLog "Bind of $Thumbprint failed ($failure). Rolling back to $oldTp." -Level ERROR
    $rb = 'rollback failed'
    try {
        Invoke-CRNetsh -Arguments (Get-CRNetshUpdateArgument -Binding $before -Thumbprint $oldTp) | Out-Null
        Restart-CRWebSite -Name $SiteName
        if (Test-CRVspcWebUiServing -Thumbprint $oldTp -Before $before -HostName $Domain -Port $Port) { $rb = "rolled back to $oldTp (verified)" }
    } catch { $rb = "rollback failed: $($_.Exception.Message)" }
    Write-CRLog "Rollback result: $rb" -Level ERROR
    throw "VSPC Web UI bind of $Thumbprint failed ($failure); $rb."
}

function Get-CRVspcServerRoleThumbprint {
    <# Server certificate as VSPC reports it (REST API); $null when the API key is not configured.
       NOTE: HKLM:\SOFTWARE\Veeam\VAC\ServerCommunicationCertificate is NOT this setting. #>
    [CmdletBinding()]
    param()
    if (-not (Test-CRVspcApiConfigured)) { return $null }
    try { Get-CRVspcServerCertThumbprint -Retries 2 } catch { Write-CRLog "Could not read VSPC Server cert: $($_.Exception.Message)" -Level WARN; $null }
}

# ----------------------------------------------------------------------------------------
# VSPC Server certificate (management agents) via the VSPC REST API v3
#   GET|PUT /api/v3/configuration/certificates/console   body { "thumbprint": "..." }
#   GET     /api/v3/infrastructure/managementAgents        (connectionStatus)
# then restart the 'Veeam Management Portal' service, per Veeam:
# https://helpcenter.veeam.com/docs/vac/provider_admin/configure_server_certificate.html
# The API key (Portal Administrator, created once in the console) is stored on the server only,
# RSA-OAEP-SHA256 encrypted to a non-exportable CNG machine key; it is never logged.
# ----------------------------------------------------------------------------------------
$script:VspcKeyName = 'AxusCertRenewal-VspcApi'
$script:VspcKeyBlob = Join-Path $script:Root 'vspc-apikey.bin'
$script:VspcServerTpFile = Join-Path $script:Root 'vspc-server-thumbprint.txt'

function Get-CRVspcKnownServerThumbprint {
    <# Last Server certificate this automation installed (or recorded); used when the API is unavailable. #>
    if (Test-Path $script:VspcServerTpFile) { "$(Get-Content -LiteralPath $script:VspcServerTpFile -Raw)".Trim().ToUpper() } else { $null }
}

function Set-CRVspcKnownServerThumbprint {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Writes a one-line state file in the automation folder.')]
    param([Parameter(Mandatory)][string]$Thumbprint)
    Set-Content -LiteralPath $script:VspcServerTpFile -Value $Thumbprint.ToUpper() -Encoding ASCII
}

function Get-CRVspcApiKeyRsa {
    <# Opens (or with -Create, creates) the server's non-exportable RSA-3072 machine key. #>
    param([switch]$Create)
    $prov = [System.Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider
    if ([System.Security.Cryptography.CngKey]::Exists($script:VspcKeyName, $prov, [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey)) {
        $k = [System.Security.Cryptography.CngKey]::Open($script:VspcKeyName, $prov, [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey)
    } elseif ($Create) {
        $p = New-Object System.Security.Cryptography.CngKeyCreationParameters
        $p.KeyCreationOptions = [System.Security.Cryptography.CngKeyCreationOptions]::MachineKey
        $p.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
        $p.Provider = $prov
        $p.Parameters.Add((New-Object System.Security.Cryptography.CngProperty('Length', [BitConverter]::GetBytes([int]3072), [System.Security.Cryptography.CngPropertyOptions]::None)))
        $k = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, $script:VspcKeyName, $p)
    } else { return $null }
    New-Object System.Security.Cryptography.RSACng($k)
}

function Test-CRVspcApiConfigured { [bool]((Test-Path $script:VspcKeyBlob) -and (Get-CRVspcApiKeyRsa)) }

function Export-CRVspcApiPublicKey {
    <# One-time setup: creates the machine key if needed and prints its PUBLIC half for the workstation. #>
    $rsa = Get-CRVspcApiKeyRsa -Create
    $pub = $rsa.ExportParameters($false)
    "PUBKEY:$([Convert]::ToBase64String($pub.Modulus));$([Convert]::ToBase64String($pub.Exponent))"
}

function Save-CRVspcApiKeyBlob {
    <# One-time setup: stores the encrypted API key, then proves it works with two read-only API calls. #>
    param([Parameter(Mandatory)][string]$CipherBase64)
    $bytes = [Convert]::FromBase64String($CipherBase64)
    $tmp = "$($script:VspcKeyBlob).new"
    [IO.File]::WriteAllBytes($tmp, $bytes)
    $prev = if (Test-Path $script:VspcKeyBlob) { [IO.File]::ReadAllBytes($script:VspcKeyBlob) } else { $null }
    Move-Item -LiteralPath $tmp -Destination $script:VspcKeyBlob -Force
    try {
        $tp = Get-CRVspcServerCertThumbprint
        $h = Get-CRVspcAgentHealth
        "API key OK. VSPC Server cert: $tp"
        "Management agents: total=$($h.Total) $($h.Text)"
    } catch {
        if ($prev) { [IO.File]::WriteAllBytes($script:VspcKeyBlob, $prev) } else { Remove-Item -LiteralPath $script:VspcKeyBlob -Force }
        throw "API key test failed, key not kept: $($_.Exception.Message)"
    }
}

function Get-CRVspcApiKey {
    $rsa = Get-CRVspcApiKeyRsa
    if (-not $rsa -or -not (Test-Path $script:VspcKeyBlob)) { throw 'VSPC API key not configured (tools/Set-VspcApiKey.ps1).' }
    $plain = $rsa.Decrypt([IO.File]::ReadAllBytes($script:VspcKeyBlob), [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
    [Text.Encoding]::UTF8.GetString($plain)
}

function Invoke-CRVspcHttp {
    <#
      HTTPS to the local VSPC Web UI with full certificate validation (curl.exe --resolve maps the
      public name to 127.0.0.1). The Authorization header goes through stdin, never the command line.
      Returns @{ Status = <int>; Body = <string> }.
    #>
    param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Path, [string]$Body,
        [Parameter(Mandatory)][string]$ApiKey, [string]$HostName = 'vspc.axusbackups.com', [int]$Port = 1280)
    $url = "https://${HostName}:$Port/api/v3$Path"
    $a = @('-s', '-S', '--max-time', '60', '--resolve', "${HostName}:${Port}:127.0.0.1", '-X', $Method,
        '-H', '@-', '-H', 'Accept: application/json', '-w', "`n%{http_code}")
    # The body goes through a temp file: Windows PowerShell 5.1 strips double quotes from arguments
    # passed to native programs, which turned {"thumbprint":"..."} into {thumbprint:...} (HTTP 400).
    $bodyFile = $null
    if ($PSBoundParameters.ContainsKey('Body')) {
        $bodyFile = Join-Path $env:TEMP ("axuscr-body-{0}.json" -f [guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($bodyFile, $Body, (New-Object System.Text.UTF8Encoding($false)))
        $a += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
    }
    $a += $url
    try { $out = ("Authorization: Bearer $ApiKey" | & curl.exe @a 2>&1) -join "`n" }
    finally { if ($bodyFile) { Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue } }
    $nl = $out.LastIndexOf("`n")
    $code = 0; [void][int]::TryParse($out.Substring($nl + 1).Trim(), [ref]$code)
    [pscustomobject]@{ Status = $code; Body = $(if ($nl -gt 0) { $out.Substring(0, $nl) } else { '' }) }
}

function Invoke-CRVspcApi {
    <# Calls the VSPC REST API; throws on non-2xx. Retries while the API is coming back after a restart. #>
    param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Path, $Body, [string]$HostName = 'vspc.axusbackups.com',
        [int]$Port = 1280, [int]$Retries = 1, [int]$RetryDelaySec = 20)
    $key = Get-CRVspcApiKey
    $p = @{ Method = $Method; Path = $Path; ApiKey = $key; HostName = $HostName; Port = $Port }
    if ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json -Depth 6 -Compress) }
    $r = $null
    for ($i = 1; $i -le $Retries; $i++) {
        $r = Invoke-CRVspcHttp @p
        if ($r.Status -ge 200 -and $r.Status -lt 300) { if ($r.Body) { return ($r.Body | ConvertFrom-Json) } else { return $null } }
        if ($r.Status -in 401, 403) { throw "VSPC API $Method $Path -> HTTP $($r.Status) (API key rejected or not Portal Administrator)." }
        if ($i -lt $Retries) { Start-Sleep -Seconds $RetryDelaySec }
    }
    $snippet = "$($r.Body)"; if ($snippet.Length -gt 300) { $snippet = $snippet.Substring(0, 300) }
    throw "VSPC API $Method $Path -> HTTP $($r.Status): $snippet"
}

function Get-CRVspcServerCertThumbprint {
    param([int]$Retries = 1)
    $r = Invoke-CRVspcApi -Method GET -Path '/configuration/certificates/console' -Retries $Retries
    "$($r.data.thumbprint)".ToUpper()
}

function Get-CRVspcAgentHealth {
    <# Counts of management agents by connection status (Online/Inaccessible/Rejected/...). #>
    param([int]$Retries = 1)
    $all = @(); $offset = 0
    do {
        $r = Invoke-CRVspcApi -Method GET -Path "/infrastructure/managementAgents?limit=500&offset=$offset" -Retries $Retries
        $page = @($r.data); $all += $page; $offset += $page.Count
    } while ($page.Count -eq 500)
    $by = @{}; foreach ($a in $all) { $s = "$($a.connectionStatus)"; if (-not $by.ContainsKey($s)) { $by[$s] = 0 }; $by[$s]++ }
    [pscustomobject]@{
        Total    = $all.Count
        Online   = [int]$by['Online']
        Rejected = [int]$by['Rejected']
        Text     = (($by.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ')
    }
}

function Restart-CRVspcPortalService {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseShouldProcessForStateChangingFunctions', '', Justification = 'Internal helper; only called inside the ShouldProcess-gated Set-CRVspcServerCertificate.')]
    param()
    Restart-Service -Name 'VeeamManagementPortalSvc' -Force -ErrorAction Stop
}

function Wait-CRVspcAgentRecovery {
    <#
      After a Server-cert change: wait until Online agents are back to at least the baseline minus a
      small tolerance (5%, min 1), with no increase in Rejected. Returns $true, or $false on timeout.
    #>
    param([Parameter(Mandatory)]$Baseline, [int]$TimeoutMin = 20, [int]$PollSec = 60, [int]$InitialWaitSec = 90)
    $tolerance = [Math]::Max(1, [int][Math]::Floor($Baseline.Online * 0.05))
    $need = [Math]::Max(0, $Baseline.Online - $tolerance)
    $deadline = (Get-Date).AddMinutes($TimeoutMin)
    Start-Sleep -Seconds $InitialWaitSec
    do {
        try {
            $h = Get-CRVspcAgentHealth -Retries 3
            Write-CRLog "Agents: $($h.Text) (need Online >= $need, Rejected <= $($Baseline.Rejected))"
            if ($h.Online -ge $need -and $h.Rejected -le $Baseline.Rejected) { return $true }
        } catch { Write-CRLog "Agent check failed: $($_.Exception.Message)" -Level WARN }
        Start-Sleep -Seconds $PollSec
    } while ((Get-Date) -lt $deadline)
    $false
}

function Set-CRVspcServerCertificate {
    <#
      Installs a certificate (already in LocalMachine\My) as the VSPC Server certificate through the
      REST API, restarts the Veeam Management Portal service, verifies the API reports it, waits for
      management agents to reconnect, and ROLLS BACK to the previous certificate if they do not.
      Same safety rules as the Web UI / VCC binds (first switch away from non-LE needs
      -AllowSwitchFromNonLE; afterwards only a later-expiring LE cert).
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
    param(
        [Parameter(Mandatory)][string]$Thumbprint,
        [Parameter(Mandatory)][string]$Domain,
        [switch]$AllowSwitchFromNonLE,
        [int]$AgentTimeoutMin = 20
    )
    $Thumbprint = $Thumbprint.ToUpper()
    $target = Get-CRStoreCertificate -Thumbprint $Thumbprint
    if (-not $target) { throw "Certificate $Thumbprint is not in LocalMachine\My." }
    $check = Test-CRCertUsable -Certificate $target -Domain $Domain
    if (-not $check.Usable) { throw "Refusing to bind ${Thumbprint}: $($check.Reasons -join '; ')" }

    $oldTp = Get-CRVspcServerCertThumbprint -Retries 3
    if ($oldTp -eq $Thumbprint) { Write-CRLog "VSPC Server cert already $Thumbprint" -Summary; return $false }
    $old = Get-CRStoreCertificate -Thumbprint $oldTp
    $oldIsLE = Test-CRIsLetsEncryptProd $old
    if (-not $oldIsLE -and -not $AllowSwitchFromNonLE) {
        throw "Current VSPC Server cert $oldTp is not Let's Encrypt. First switch needs -AllowSwitchFromNonLE (human-approved)."
    }
    if ($oldIsLE -and $old -and $target.NotAfter -le $old.NotAfter) { throw "Target $Thumbprint does not expire later than current $oldTp; not changing." }
    if (-not $old) { Write-CRLog "Previous Server cert $oldTp is not in LocalMachine\My; rollback would not be possible." -Level WARN }

    if (-not $PSCmdlet.ShouldProcess('VSPC Server certificate', "Install $Thumbprint (replacing $oldTp) and restart Veeam Management Portal")) { return $false }

    $baseline = Get-CRVspcAgentHealth -Retries 3
    Write-CRLog "Server cert $oldTp -> $Thumbprint. Agents before: $($baseline.Text)" -Summary
    $failure = $null; $changed = $false
    try {
        Invoke-CRVspcApi -Method PUT -Path '/configuration/certificates/console' -Body @{ thumbprint = $Thumbprint } -Retries 2 | Out-Null
        $changed = $true
        Set-CRVspcKnownServerThumbprint -Thumbprint $Thumbprint
        Restart-CRVspcPortalService
        $now = Get-CRVspcServerCertThumbprint -Retries 10
        if ($now -ne $Thumbprint) { $failure = "API reports $now after install" }
        elseif (-not (Wait-CRVspcAgentRecovery -Baseline $baseline -TimeoutMin $AgentTimeoutMin)) { $failure = "management agents did not reconnect within $AgentTimeoutMin min" }
    } catch { $failure = $_.Exception.Message }

    if (-not $failure) { Write-CRLog "Server cert verified: $Thumbprint; agents reconnected" -Summary; return $true }
    if (-not $changed -and (Get-CRVspcServerCertThumbprint -Retries 3) -eq $oldTp) {
        throw "VSPC Server cert change to $Thumbprint was rejected ($failure). Nothing was changed; still $oldTp."
    }
    if (-not $old) { throw "VSPC Server cert change to $Thumbprint failed ($failure); previous cert not available for rollback." }

    Write-CRLog "Server cert change failed ($failure). Rolling back to $oldTp." -Level ERROR
    $rb = 'rollback failed'
    try {
        Invoke-CRVspcApi -Method PUT -Path '/configuration/certificates/console' -Body @{ thumbprint = $oldTp } -Retries 5 | Out-Null
        Restart-CRVspcPortalService
        if ((Get-CRVspcServerCertThumbprint -Retries 10) -eq $oldTp) { $rb = "rolled back to $oldTp (verified)" }
    } catch { $rb = "rollback failed: $($_.Exception.Message)" }
    Write-CRLog "Rollback result: $rb" -Level ERROR
    throw "VSPC Server cert change to $Thumbprint failed ($failure); $rb."
}

# ----------------------------------------------------------------------------------------
# Notifications: always Windows Event Log; e-mail via Microsoft Graph using the VM's managed
# identity when config.json has NotifyFrom + NotifyTo (needs Mail.Send app role, see RUNBOOK).
# ----------------------------------------------------------------------------------------
function Write-CREvent {
    param([Parameter(Mandatory)][string]$Message, [ValidateSet('Information', 'Warning', 'Error')][string]$EntryType = 'Information', [int]$EventId = 1000)
    try {
        $type = [System.Diagnostics.EventLogEntryType]::$EntryType
        [System.Diagnostics.EventLog]::WriteEntry($script:EventSource, $Message, $type, $EventId)
    } catch { Write-CRLog "Event log write failed: $($_.Exception.Message)" -Level WARN }
}

function Send-CRNotification {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Subject,
        [Parameter(Mandatory)][string]$Body,
        [ValidateSet('Information', 'Warning', 'Error')][string]$Severity = 'Information',
        $Config
    )
    $eventId = @{ Information = 1000; Warning = 2000; Error = 3000 }[$Severity]
    Write-CREvent -Message "$Subject`r`n`r`n$Body" -EntryType $Severity -EventId $eventId

    $from = Get-CRConfigValue $Config 'NotifyFrom' $null
    $to = @(Get-CRConfigValue $Config 'NotifyTo' @())
    if (-not $from -or $to.Count -eq 0) { Write-CRLog 'E-mail not configured (NotifyFrom/NotifyTo); event log only.'; return $false }
    try {
        $token = Get-CRManagedIdentityToken -Resource 'https://graph.microsoft.com/'
        $msg = @{
            message         = @{
                subject      = "[$($env:COMPUTERNAME)] $Subject"
                body         = @{ contentType = 'Text'; content = $Body }
                toRecipients = @($to | ForEach-Object { @{ emailAddress = @{ address = $_ } } })
            }
            saveToSentItems = $false
        } | ConvertTo-Json -Depth 6
        Invoke-RestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/users/$from/sendMail" `
            -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $msg -UseBasicParsing | Out-Null
        Write-CRLog "E-mail sent: $Subject"
        $true
    } catch {
        Write-CRLog "E-mail failed ($($_.Exception.Message)); event log entry was written." -Level WARN
        $false
    }
}

# ----------------------------------------------------------------------------------------
# Run status file (what the daily check reads)
# ----------------------------------------------------------------------------------------
function Write-CRStatus {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][hashtable]$Data)
    $Data['Timestamp'] = (Get-Date).ToString('o')
    $Data['Computer'] = $env:COMPUTERNAME
    $path = Join-Path $script:Root ("status-{0}.json" -f $Name)
    $Data | ConvertTo-Json -Depth 4 | Set-Content -Path $path -Encoding UTF8
    $path
}

Export-ModuleMember -Function *-CR*
