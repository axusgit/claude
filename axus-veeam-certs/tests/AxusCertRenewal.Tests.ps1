#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }
# Unit tests with mocks: no network, no Let's Encrypt, no Azure, no Veeam, no cert store changes.

BeforeAll {
    $script:Scripts = Join-Path $PSScriptRoot '..\scripts'

    # Stubs so Pester can mock commands that are not installed on the workstation.
    function global:Set-PAServer { param($DirectoryUrl) }
    function global:Get-PAAccount { }
    function global:New-PAAccount { param([switch]$AcceptTOS) }
    function global:Get-PAOrder { param($MainDomain) }
    function global:Get-PACertificate { param($MainDomain) }
    function global:New-PACertificate { [CmdletBinding()] param($Domain, $Plugin, $PluginArgs, $CertKeyLength, [switch]$AlwaysNewKey, $Profile, $FriendlyName, [switch]$Install, [switch]$AcceptTOS) }
    function global:Submit-Renewal { [CmdletBinding()] param($MainDomain, [switch]$Force) }
    function global:Get-VBRCloudGatewayCertificate { param([switch]$FromStore) }
    function global:Add-VBRCloudGatewayCertificate { [CmdletBinding(SupportsShouldProcess)] param($Certificate) }

    Import-Module (Join-Path $script:Scripts 'AxusCertRenewal.psm1') -Force

    function global:New-FakeCert {
        param([string]$Tp, [string]$Issuer = "CN=R12, O=Let's Encrypt, C=US", [string[]]$San = @('vcc.axusbackups.com'),
            [int]$DaysLeft = 89, [bool]$Key = $true)
        [pscustomobject]@{
            Thumbprint = $Tp; Issuer = $Issuer; HasPrivateKey = $Key
            NotBefore = (Get-Date).AddDays(-1); NotAfter = (Get-Date).AddDays($DaysLeft)
            DnsNameList = @($San | ForEach-Object { [pscustomobject]@{ Unicode = $_ } })
        }
    }
}

AfterAll {
    Remove-Module AxusCertRenewal -Force -ErrorAction SilentlyContinue
}

Describe 'Safety defaults (static checks)' {
    It '<_> has a mandatory -Environment with no default' -ForEach @('Invoke-VccRenewal.ps1', 'Invoke-VspcRenewal.ps1', 'Register-CertRenewalTask.ps1') {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $script:Scripts $_), [ref]$null, [ref]$null)
        $p = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Environment' }
        $p | Should -Not -BeNullOrEmpty
        $p.DefaultValue | Should -BeNullOrEmpty
        ($p.Attributes.NamedArguments | Where-Object ArgumentName -eq 'Mandatory') | Should -Not -BeNullOrEmpty
    }
    It 'no script references the production ACME URL or LE_PROD outside the explicit mapping' {
        $hits = Get-ChildItem $script:Scripts -Filter *.ps* | Select-String -Pattern "LE_PROD|acme-v02\.api\.letsencrypt\.org/directory"
        @($hits).Count | Should -Be 1
        $hits[0].Line | Should -Match "if \(\`$Environment -eq 'Production'\) \{ 'LE_PROD' \}"
    }
    It 'Initialize never removes inheritance recursively (would leave files with an empty ACL)' {
        $bad = Select-String -Path (Join-Path $script:Scripts 'Initialize-CertRenewal.ps1') -Pattern 'inheritance:r.*/T|/T.*inheritance:r' | Where-Object { $_.Line -notmatch '^\s*#' }
        @($bad).Count | Should -Be 0
    }
    It 'no file in the project contains a GUID, private key block, or password assignment' {
        $root = Join-Path $PSScriptRoot '..'
        $files = Get-ChildItem $root -Recurse -File -Include *.ps1, *.psm1, *.md, *.json | Where-Object FullName -notmatch '\\payloads\\|\\logs\\'
        # Allowed: the public, well-known Microsoft Graph application ID.
        $guid = $files | Select-String -Pattern '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b' |
            Where-Object { ($_.Matches.Value | Where-Object { $_ -ne '00000003-0000-0000-c000-000000000000' }) }
        $pk = $files | Select-String -Pattern '-----BEGIN [A-Z ]*PRIVATE KEY-----'
        $pw = $files | Select-String -Pattern '(?i)(password|secret)\s*=\s*[''"][^''"]+[''"]'
        @($guid).Count | Should -Be 0 -Because ($guid | Out-String)
        @($pk).Count | Should -Be 0
        @($pw).Count | Should -Be 0 -Because ($pw | Out-String)
    }
}

Describe 'Get-CRAcmeServerName' {
    It 'maps Staging to LE_STAGE' { Get-CRAcmeServerName -Environment Staging | Should -Be 'LE_STAGE' }
    It 'maps Production to LE_PROD' { Get-CRAcmeServerName -Environment Production | Should -Be 'LE_PROD' }
    It 'rejects anything else' { { Get-CRAcmeServerName -Environment 'Prod' } | Should -Throw }
}

Describe 'Test-CRInWindow' {
    It 'inside a same-day window' { Test-CRInWindow -Window '01:00-05:00' -Now ([datetime]'2026-11-14 02:30') | Should -BeTrue }
    It 'at the end boundary is outside' { Test-CRInWindow -Window '01:00-05:00' -Now ([datetime]'2026-11-14 05:00') | Should -BeFalse }
    It 'outside a same-day window' { Test-CRInWindow -Window '01:00-05:00' -Now ([datetime]'2026-11-14 12:00') | Should -BeFalse }
    It 'window across midnight, late' { Test-CRInWindow -Window '22:00-04:00' -Now ([datetime]'2026-11-14 23:10') | Should -BeTrue }
    It 'window across midnight, early' { Test-CRInWindow -Window '22:00-04:00' -Now ([datetime]'2026-11-14 03:59') | Should -BeTrue }
    It 'window across midnight, midday' { Test-CRInWindow -Window '22:00-04:00' -Now ([datetime]'2026-11-14 12:00') | Should -BeFalse }
    It 'bad format throws' { { Test-CRInWindow -Window '1-5' } | Should -Throw }
}

Describe 'Test-CRIsLetsEncryptProd / Test-CRCertUsable' {
    It 'production LE issuer is accepted' { Test-CRIsLetsEncryptProd (New-FakeCert -Tp A) | Should -BeTrue }
    It 'staging LE issuer is rejected' { Test-CRIsLetsEncryptProd (New-FakeCert -Tp A -Issuer "CN=(STAGING) Ersatz Edamame E1, O=(STAGING) Let's Encrypt, C=US") | Should -BeFalse }
    It 'Sectigo is rejected' { Test-CRIsLetsEncryptProd (New-FakeCert -Tp A -Issuer 'CN=Sectigo Public Server Authentication CA DV R36, O=Sectigo Limited, C=GB') | Should -BeFalse }
    It 'null is rejected' { Test-CRIsLetsEncryptProd $null | Should -BeFalse }
    It 'usable cert has no reasons' { (Test-CRCertUsable -Certificate (New-FakeCert -Tp A) -Domain 'vcc.axusbackups.com').Usable | Should -BeTrue }
    It 'wrong SAN, no key, near expiry are all reported' {
        $r = Test-CRCertUsable -Certificate (New-FakeCert -Tp A -San 'other.example' -Key $false -DaysLeft 3) -Domain 'vcc.axusbackups.com'
        $r.Usable | Should -BeFalse
        $r.Reasons.Count | Should -Be 3
    }
}

Describe 'Invoke-CRCertificate' {
    BeforeEach {
        Mock -ModuleName AxusCertRenewal Write-CRLog { }
        Mock -ModuleName AxusCertRenewal Get-CRSubscriptionId { 'SUB-FROM-IMDS' }
    }
    It 'new STAGING order: RSA 4096, classic, IMDS, new key, NOT installed' {
        Mock -ModuleName AxusCertRenewal Get-PAOrder { $null }
        Mock -ModuleName AxusCertRenewal New-PACertificate { [pscustomobject]@{ Thumbprint = 'S1'; NotAfter = (Get-Date).AddDays(90) } }
        $r = Invoke-CRCertificate -Domain 'vspc.axusbackups.com' -Environment Staging -NewOrder
        $r.Action | Should -Be 'Issued'
        $r.Installed | Should -BeFalse
        Should -Invoke -ModuleName AxusCertRenewal New-PACertificate -Times 1 -ParameterFilter {
            $CertKeyLength -eq '4096' -and $Profile -eq 'classic' -and $AlwaysNewKey -and -not $Install -and
            $Plugin -eq 'Azure' -and $PluginArgs.AZUseIMDS -eq $true -and $PluginArgs.AZSubscriptionId -eq 'SUB-FROM-IMDS' -and
            $Domain -eq 'vspc.axusbackups.com'
        }
    }
    It 'new PRODUCTION order installs into the machine store' {
        Mock -ModuleName AxusCertRenewal Get-PAOrder { $null }
        Mock -ModuleName AxusCertRenewal New-PACertificate { [pscustomobject]@{ Thumbprint = 'P1'; NotAfter = (Get-Date).AddDays(90) } }
        (Invoke-CRCertificate -Domain 'vspc.axusbackups.com' -Environment Production -NewOrder).Installed | Should -BeTrue
        Should -Invoke -ModuleName AxusCertRenewal New-PACertificate -Times 1 -ParameterFilter { $Install }
    }
    It 'refuses -NewOrder when an order already exists' {
        Mock -ModuleName AxusCertRenewal Get-PAOrder { [pscustomobject]@{ MainDomain = 'x'; RenewAfter = 'y' } }
        Mock -ModuleName AxusCertRenewal New-PACertificate { }
        { Invoke-CRCertificate -Domain 'x' -Environment Staging -NewOrder } | Should -Throw '*already exists*'
        Should -Invoke -ModuleName AxusCertRenewal New-PACertificate -Times 0
    }
    It 'renewal not due returns NotDue and current cert' {
        Mock -ModuleName AxusCertRenewal Get-PAOrder { [pscustomobject]@{ MainDomain = 'x'; RenewAfter = '2027-01-01' } }
        Mock -ModuleName AxusCertRenewal Submit-Renewal { }
        Mock -ModuleName AxusCertRenewal Get-PACertificate { [pscustomobject]@{ Thumbprint = 'CUR'; NotAfter = (Get-Date).AddDays(60) } }
        $r = Invoke-CRCertificate -Domain 'x' -Environment Production
        $r.Action | Should -Be 'NotDue'
        $r.Thumbprint | Should -Be 'CUR'
    }
    It 'renewal due returns Renewed' {
        Mock -ModuleName AxusCertRenewal Get-PAOrder { [pscustomobject]@{ MainDomain = 'x'; RenewAfter = '2026-01-01' } }
        Mock -ModuleName AxusCertRenewal Submit-Renewal { [pscustomobject]@{ Thumbprint = 'NEW'; NotAfter = (Get-Date).AddDays(90) } }
        (Invoke-CRCertificate -Domain 'x' -Environment Production).Action | Should -Be 'Renewed'
        Should -Invoke -ModuleName AxusCertRenewal Submit-Renewal -Times 1 -ParameterFilter { -not $Force }
    }
    It 'renewal without an order throws' {
        Mock -ModuleName AxusCertRenewal Get-PAOrder { $null }
        { Invoke-CRCertificate -Domain 'x' -Environment Production } | Should -Throw '*No order*'
    }
}

Describe 'Initialize-CRAcme' {
    BeforeEach {
        Mock -ModuleName AxusCertRenewal Write-CRLog { }
        Mock -ModuleName AxusCertRenewal Import-Module { }
        Mock -ModuleName AxusCertRenewal Set-PAServer { }
        Mock -ModuleName AxusCertRenewal New-PAAccount { [pscustomobject]@{ id = 'acct' } }
    }
    It 'does not create an account unless allowed' {
        Mock -ModuleName AxusCertRenewal Get-PAAccount { $null }
        { Initialize-CRAcme -Environment Staging } | Should -Throw '*No ACME account*'
        Should -Invoke -ModuleName AxusCertRenewal New-PAAccount -Times 0
    }
    It 'creates an account when allowed, on the staging server' {
        Mock -ModuleName AxusCertRenewal Get-PAAccount { $null }
        Initialize-CRAcme -Environment Staging -AllowNewAccount | Out-Null
        Should -Invoke -ModuleName AxusCertRenewal Set-PAServer -Times 1 -ParameterFilter { $DirectoryUrl -eq 'LE_STAGE' }
        Should -Invoke -ModuleName AxusCertRenewal New-PAAccount -Times 1
    }
}

Describe 'Set-CRVccCertificate (gateway bind safety)' {
    BeforeEach {
        Mock -ModuleName AxusCertRenewal Write-CRLog { }
        Mock -ModuleName AxusCertRenewal Import-CRVeeamModule { }
        $script:sectigo = New-FakeCert -Tp 'SECTIGO' -Issuer 'CN=Sectigo Public Server Authentication CA DV R36, O=Sectigo Limited, C=GB' -DaysLeft 96
        $script:le1 = New-FakeCert -Tp 'LE1' -DaysLeft 30
        $script:le2 = New-FakeCert -Tp 'LE2' -DaysLeft 89
        Mock -ModuleName AxusCertRenewal Get-CRStoreCertificate { switch ($Thumbprint) { 'SECTIGO' { $script:sectigo } 'LE1' { $script:le1 } 'LE2' { $script:le2 } } }
        Mock -ModuleName AxusCertRenewal Get-VBRCloudGatewayCertificate -ParameterFilter { $FromStore } { @([pscustomobject]@{ Thumbprint = 'LE1' }, [pscustomobject]@{ Thumbprint = 'LE2' }) }
        Mock -ModuleName AxusCertRenewal Add-VBRCloudGatewayCertificate { $script:boundNow = $Certificate.Thumbprint }
    }
    It 'refuses the first switch away from Sectigo without -AllowSwitchFromNonLE' {
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = 'SECTIGO' } }
        { Set-CRVccCertificate -Thumbprint 'LE2' -Domain 'vcc.axusbackups.com' -Confirm:$false } | Should -Throw '*not Let''s Encrypt*'
        Should -Invoke -ModuleName AxusCertRenewal Add-VBRCloudGatewayCertificate -Times 0
    }
    It 'switches from Sectigo when explicitly allowed, and verifies' {
        $script:boundNow = 'SECTIGO'
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = $script:boundNow } }
        Set-CRVccCertificate -Thumbprint 'le2' -Domain 'vcc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false | Should -BeTrue
        Should -Invoke -ModuleName AxusCertRenewal Add-VBRCloudGatewayCertificate -Times 1 -ParameterFilter { $Certificate.Thumbprint -eq 'LE2' }
    }
    It 'LE -> newer LE binds without the switch flag' {
        $script:boundNow = 'LE1'
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = $script:boundNow } }
        Set-CRVccCertificate -Thumbprint 'LE2' -Domain 'vcc.axusbackups.com' -Confirm:$false | Should -BeTrue
    }
    It 'refuses to replace with an older-or-equal LE cert' {
        $script:boundNow = 'LE2'
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = $script:boundNow } }
        { Set-CRVccCertificate -Thumbprint 'LE1' -Domain 'vcc.axusbackups.com' -Confirm:$false } | Should -Throw '*does not expire later*'
    }
    It 'does nothing when already bound' {
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = 'LE2' } }
        Set-CRVccCertificate -Thumbprint 'LE2' -Domain 'vcc.axusbackups.com' -Confirm:$false | Should -BeFalse
        Should -Invoke -ModuleName AxusCertRenewal Add-VBRCloudGatewayCertificate -Times 0
    }
    It 'refuses a staging or wrong-SAN cert' {
        $script:le2 = New-FakeCert -Tp 'LE2' -Issuer "CN=(STAGING) Pseudo Plum E5, O=(STAGING) Let's Encrypt, C=US"
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = 'LE1' } }
        { Set-CRVccCertificate -Thumbprint 'LE2' -Domain 'vcc.axusbackups.com' -Confirm:$false } | Should -Throw '*Refusing to bind*'
    }
    It 'throws when post-bind verification fails' {
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = 'LE1' } }   # never changes
        { Set-CRVccCertificate -Thumbprint 'LE2' -Domain 'vcc.axusbackups.com' -Confirm:$false } | Should -Throw '*verification failed*'
    }
    It 'honours -WhatIf (no bind)' {
        Mock -ModuleName AxusCertRenewal Get-CRVccBoundCertificate { [pscustomobject]@{ Thumbprint = 'LE1' } }
        Set-CRVccCertificate -Thumbprint 'LE2' -Domain 'vcc.axusbackups.com' -WhatIf | Should -BeFalse
        Should -Invoke -ModuleName AxusCertRenewal Add-VBRCloudGatewayCertificate -Times 0
    }
}

Describe 'Get-CRVspcWebUiThumbprint / Get-CRSslBinding' {
    It 'parses netsh output (IP:port key, extended properties ignored)' {
        Mock -ModuleName AxusCertRenewal Invoke-CRNetsh { , @(
                'SSL Certificate bindings:', '-------------------------', '',
                '    IP:port                      : 0.0.0.0:1280',
                '    Certificate Hash             : 498f73a3836d3bd7973a477759f01610bc190140',
                '    Application ID               : {appid}',
                '    Certificate Store Name       : MY',
                '    DS Mapper Usage              : Enabled',
                ' Extended Properties:', '    PropertyId                   : 0') }
        Get-CRVspcWebUiThumbprint | Should -Be '498F73A3836D3BD7973A477759F01610BC190140'
        $b = Get-CRSslBinding -Port 1280
        $b.Settings['IP:port'] | Should -Be '0.0.0.0:1280'
        $b.Settings['DS Mapper Usage'] | Should -Be 'Enabled'
        $b.Settings.Contains('PropertyId') | Should -BeFalse
    }
    It 'throws when no binding exists' {
        Mock -ModuleName AxusCertRenewal Invoke-CRNetsh { , @('The system cannot find the file specified.') }
        { Get-CRVspcWebUiThumbprint } | Should -Throw '*No HTTP.sys SSL binding*'
    }
}

Describe 'Set-CRVspcWebUiCertificate (Web UI bind safety + rollback)' {
    BeforeEach {
        Mock -ModuleName AxusCertRenewal Write-CRLog { }
        Mock -ModuleName AxusCertRenewal Start-Sleep { }
        Mock -ModuleName AxusCertRenewal Get-CRVspcWebUiSiteName { 'VSPC Web UI' }
        Mock -ModuleName AxusCertRenewal Restart-CRWebSite { $script:restarts++ }
        $script:restarts = 0
        $script:sectigo = New-FakeCert -Tp 'SECTIGO' -Issuer 'CN=Sectigo Public Server Authentication CA DV R36, O=Sectigo Limited, C=GB' -DaysLeft 28 -San 'vspc.axusbackups.com'
        $script:le1 = New-FakeCert -Tp 'LE1' -DaysLeft 30 -San 'vspc.axusbackups.com'
        $script:le2 = New-FakeCert -Tp 'LE2' -DaysLeft 89 -San 'vspc.axusbackups.com'
        Mock -ModuleName AxusCertRenewal Get-CRStoreCertificate { switch ($Thumbprint) { 'SECTIGO' { $script:sectigo } 'LE1' { $script:le1 } 'LE2' { $script:le2 } } }

        # Simulated HTTP.sys binding. 'update' behaves like netsh: unspecified flags reset to defaults.
        $script:http = [ordered]@{
            'IP:port' = '0.0.0.0:1280'; 'Certificate Hash' = 'sectigo'; 'Application ID' = '{appid}'; 'Certificate Store Name' = 'MY'
            'Verify Client Certificate Revocation' = 'Enabled'; 'Usage Check' = 'Enabled'; 'DS Mapper Usage' = 'Enabled'; 'Negotiate Client Certificate' = 'Disabled'
        }
        $script:updates = New-Object System.Collections.Generic.List[string]
        $script:failUpdateTo = $null
        $script:serveOverride = $null
        Mock -ModuleName AxusCertRenewal Invoke-CRNetsh {
            if ($Arguments -contains 'show') { return , @($script:http.GetEnumerator() | ForEach-Object { '    {0,-28} : {1}' -f $_.Key, $_.Value }) }
            $tp = (($Arguments | Where-Object { $_ -like 'certhash=*' }) -replace '^certhash=', '')
            $script:updates.Add($tp.ToUpper())
            if ($script:failUpdateTo -eq $tp.ToUpper()) { throw 'netsh failed (simulated)' }
            $script:http['Certificate Hash'] = $tp
            $script:http['Verify Client Certificate Revocation'] = 'Enabled'; $script:http['Usage Check'] = 'Enabled'
            $script:http['DS Mapper Usage'] = 'Disabled'; $script:http['Negotiate Client Certificate'] = 'Disabled'
            if ($Arguments -contains 'dsmapperusage=enable') { $script:http['DS Mapper Usage'] = 'Enabled' }
            , @('SSL Certificate successfully updated')
        }
        Mock -ModuleName AxusCertRenewal Get-CRServedThumbprint { if ($script:serveOverride) { $script:serveOverride } else { "$($script:http['Certificate Hash'])".ToUpper() } }
    }
    It 'refuses the first switch away from Sectigo without -AllowSwitchFromNonLE' {
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -Confirm:$false } | Should -Throw '*not Let''s Encrypt*'
        $script:updates.Count | Should -Be 0
        $script:restarts | Should -Be 0
    }
    It 'switches from Sectigo when allowed: keeps every binding setting, restarts the site once, verifies' {
        Set-CRVspcWebUiCertificate -Thumbprint 'le2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false | Should -BeTrue
        $script:http['Certificate Hash'] | Should -Be 'le2'
        $script:http['DS Mapper Usage'] | Should -Be 'Enabled'
        $script:restarts | Should -Be 1
        Should -Invoke -ModuleName AxusCertRenewal Invoke-CRNetsh -ParameterFilter {
            ($Arguments -contains 'update') -and ($Arguments -contains 'appid={appid}') -and ($Arguments -contains 'certstorename=MY') -and ($Arguments -contains 'ipport=0.0.0.0:1280') }
    }
    It 'LE -> newer LE binds without the switch flag' {
        $script:http['Certificate Hash'] = 'le1'
        Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -Confirm:$false | Should -BeTrue
    }
    It 'refuses to replace with an older-or-equal LE cert' {
        $script:http['Certificate Hash'] = 'le2'
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE1' -Domain 'vspc.axusbackups.com' -Confirm:$false } | Should -Throw '*does not expire later*'
    }
    It 'does nothing when already bound' {
        $script:http['Certificate Hash'] = 'le2'
        Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -Confirm:$false | Should -BeFalse
        $script:updates.Count | Should -Be 0
    }
    It 'refuses a staging or wrong-SAN cert' {
        $script:le2 = New-FakeCert -Tp 'LE2' -San 'vcc.axusbackups.com'
        $script:http['Certificate Hash'] = 'le1'
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -Confirm:$false } | Should -Throw '*Refusing to bind*'
    }
    It 'rolls back to the previous cert when the site does not serve the new one' {
        $script:serveOverride = 'SOMETHINGELSE'
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false } | Should -Throw '*failed*'
        $script:http['Certificate Hash'] | Should -Be 'SECTIGO'
        $script:http['DS Mapper Usage'] | Should -Be 'Enabled'
        ($script:updates -join ',') | Should -Be 'LE2,SECTIGO'
        $script:restarts | Should -Be 2
    }
    It 'rolls back and reports success of the rollback when netsh update fails' {
        $script:failUpdateTo = 'LE2'
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false } | Should -Throw '*rolled back to SECTIGO (verified)*'
        $script:http['Certificate Hash'] | Should -Be 'SECTIGO'
    }
    It 'rolls back when binding settings change' {
        Mock -ModuleName AxusCertRenewal Get-CRNetshUpdateArgument { , @('http', 'update', 'sslcert', 'ipport=0.0.0.0:1280', "certhash=$Thumbprint") }   # drops dsmapperusage
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false } | Should -Throw '*failed*'
        $script:http['Certificate Hash'] | Should -Be 'SECTIGO'
    }
    It 'honours -WhatIf (no change)' {
        Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -WhatIf | Should -BeFalse
        $script:updates.Count | Should -Be 0
        $script:restarts | Should -Be 0
    }
    It 'refuses when there is no existing binding (never creates one)' {
        Mock -ModuleName AxusCertRenewal Invoke-CRNetsh { , @('The system cannot find the file specified.') }
        { Set-CRVspcWebUiCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false } | Should -Throw '*not creating one*'
    }
}

Describe 'Get-CRNetshUpdateArgument' {
    It 'copies flags and numeric settings from the current binding' {
        $b = [pscustomobject]@{ Port = 1280; AppId = '{appid}'; Store = 'MY'; Settings = [ordered]@{
                'Verify Client Certificate Revocation' = 'Enabled'; 'Verify Revocation Using Cached Client Certificate Only' = 'Disabled'
                'Usage Check' = 'Enabled'; 'Revocation Freshness Time' = '0'; 'URL Retrieval Timeout' = '0'
                'DS Mapper Usage' = 'Enabled'; 'Negotiate Client Certificate' = 'Disabled' } }
        $a = Get-CRNetshUpdateArgument -Binding $b -Thumbprint 'ABCDEF'
        $a | Should -Contain 'certhash=abcdef'
        $a | Should -Contain 'dsmapperusage=enable'
        $a | Should -Contain 'verifyclientcertrevocation=enable'
        $a | Should -Contain 'verifyrevocationwithcachedclientcertonly=disable'
        $a | Should -Contain 'clientcertnegotiation=disable'
        $a | Should -Not -Contain 'revocationfreshnesstime=0'   # netsh rejects =0
        $a | Should -Not -Contain 'urlretrievaltimeout=0'
        $b.Settings['URL Retrieval Timeout'] = '15000'
        $a2 = Get-CRNetshUpdateArgument -Binding $b -Thumbprint 'ABCDEF'
        $a2 | Should -Contain 'urlretrievaltimeout=15000'
    }
}

Describe 'Send-CRNotification' {
    BeforeEach {
        Mock -ModuleName AxusCertRenewal Write-CRLog { }
        Mock -ModuleName AxusCertRenewal Write-CREvent { }
        Mock -ModuleName AxusCertRenewal Get-CRManagedIdentityToken { 'tok' }
    }
    It 'event log only when e-mail is not configured' {
        Mock -ModuleName AxusCertRenewal Invoke-RestMethod { }
        Send-CRNotification -Subject s -Body b -Config ([pscustomobject]@{ Role = 'VSPC' }) | Should -BeFalse
        Should -Invoke -ModuleName AxusCertRenewal Write-CREvent -Times 1
        Should -Invoke -ModuleName AxusCertRenewal Invoke-RestMethod -Times 0
    }
    It 'sends via Graph with the managed identity when configured' {
        Mock -ModuleName AxusCertRenewal Invoke-RestMethod { }
        $cfg = [pscustomobject]@{ NotifyFrom = 'sender@example.test'; NotifyTo = @('ops@example.test') }
        Send-CRNotification -Subject s -Body b -Severity Warning -Config $cfg | Should -BeTrue
        Should -Invoke -ModuleName AxusCertRenewal Invoke-RestMethod -Times 1 -ParameterFilter { $Uri -eq 'https://graph.microsoft.com/v1.0/users/sender@example.test/sendMail' -and $Headers.Authorization -eq 'Bearer tok' }
        Should -Invoke -ModuleName AxusCertRenewal Write-CREvent -Times 1 -ParameterFilter { $EntryType -eq 'Warning' -and $EventId -eq 2000 }
    }
    It 'e-mail failure does not throw and still writes the event' {
        Mock -ModuleName AxusCertRenewal Invoke-RestMethod { throw 'graph 403' }
        $cfg = [pscustomobject]@{ NotifyFrom = 'sender@example.test'; NotifyTo = @('ops@example.test') }
        Send-CRNotification -Subject s -Body b -Config $cfg | Should -BeFalse
        Should -Invoke -ModuleName AxusCertRenewal Write-CREvent -Times 1
    }
}

Describe 'Get-CRConfig' {
    It 'rejects an unknown role' {
        $p = Join-Path $TestDrive 'c.json'; '{"Role":"X","Domain":"a.b"}' | Set-Content $p
        { Get-CRConfig -Path $p } | Should -Throw '*VSPC or VCC*'
    }
    It 'loads a valid config' {
        $p = Join-Path $TestDrive 'c.json'; '{"Role":"VCC","Domain":"vcc.axusbackups.com"}' | Set-Content $p
        (Get-CRConfig -Path $p).Domain | Should -Be 'vcc.axusbackups.com'
    }
}

Describe 'Set-CRVspcServerCertificate (Server cert via API, agent check, rollback)' {
    BeforeEach {
        Mock -ModuleName AxusCertRenewal Write-CRLog { }
        Mock -ModuleName AxusCertRenewal Start-Sleep { }
        Mock -ModuleName AxusCertRenewal Restart-CRVspcPortalService { $script:restarts++ }
        Mock -ModuleName AxusCertRenewal Set-CRVspcKnownServerThumbprint { $script:recorded = $Thumbprint }
        $script:restarts = 0
        $script:sectigo = New-FakeCert -Tp 'SECTIGO' -Issuer 'CN=Sectigo Public Server Authentication CA DV R36, O=Sectigo Limited, C=GB' -DaysLeft 28 -San 'vspc.axusbackups.com'
        $script:le1 = New-FakeCert -Tp 'LE1' -DaysLeft 30 -San 'vspc.axusbackups.com'
        $script:le2 = New-FakeCert -Tp 'LE2' -DaysLeft 89 -San 'vspc.axusbackups.com'
        Mock -ModuleName AxusCertRenewal Get-CRStoreCertificate { switch ($Thumbprint) { 'SECTIGO' { $script:sectigo } 'LE1' { $script:le1 } 'LE2' { $script:le2 } } }
        $script:serverTp = 'SECTIGO'
        $script:puts = New-Object System.Collections.Generic.List[string]
        $script:ignorePutTo = $null
        Mock -ModuleName AxusCertRenewal Invoke-CRVspcApi {
            if ($Method -eq 'PUT') { $script:puts.Add($Body.thumbprint); if ($Body.thumbprint -ne $script:ignorePutTo) { $script:serverTp = $Body.thumbprint }; return $null }
            [pscustomobject]@{ data = [pscustomobject]@{ thumbprint = $script:serverTp } }
        }
        $script:healthAfter = [pscustomobject]@{ Total = 40; Online = 40; Rejected = 0; Text = 'Online=40' }
        $script:healthCalls = 0
        Mock -ModuleName AxusCertRenewal Get-CRVspcAgentHealth {
            $script:healthCalls++
            if ($script:healthCalls -eq 1) { [pscustomobject]@{ Total = 40; Online = 40; Rejected = 0; Text = 'Online=40' } } else { $script:healthAfter }
        }
    }
    It 'refuses the first switch away from Sectigo without -AllowSwitchFromNonLE' {
        { Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -Confirm:$false } | Should -Throw '*not Let''s Encrypt*'
        $script:puts.Count | Should -Be 0; $script:restarts | Should -Be 0
    }
    It 'switches when allowed, restarts the portal service once, waits for agents' {
        Set-CRVspcServerCertificate -Thumbprint 'le2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false | Should -BeTrue
        $script:serverTp | Should -Be 'LE2'
        $script:restarts | Should -Be 1
        $script:healthCalls | Should -BeGreaterThan 1
    }
    It 'rolls back when agents do not reconnect' {
        $script:healthAfter = [pscustomobject]@{ Total = 40; Online = 3; Rejected = 37; Text = 'Online=3 Rejected=37' }
        { Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -AgentTimeoutMin 0 -Confirm:$false } | Should -Throw '*did not reconnect*rolled back to SECTIGO (verified)*'
        ($script:puts -join ',') | Should -Be 'LE2,SECTIGO'
        $script:restarts | Should -Be 2
    }
    It 'treats one more Rejected agent as failure even if Online is fine' {
        $script:healthAfter = [pscustomobject]@{ Total = 41; Online = 40; Rejected = 1; Text = 'Online=40 Rejected=1' }
        { Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -AgentTimeoutMin 0 -Confirm:$false } | Should -Throw '*rolled back*'
    }
    It 'rolls back when the API does not report the new cert' {
        $script:ignorePutTo = 'LE2'
        { Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false } | Should -Throw '*API reports SECTIGO*'
    }
    It 'LE -> newer LE needs no switch flag; refuses older' {
        $script:serverTp = 'LE1'
        Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -Confirm:$false | Should -BeTrue
        $script:serverTp = 'LE2'
        { Set-CRVspcServerCertificate -Thumbprint 'LE1' -Domain 'vspc.axusbackups.com' -Confirm:$false } | Should -Throw '*does not expire later*'
    }
    It 'reports "nothing changed" (no restart, no rollback) when the API rejects the install' {
        Mock -ModuleName AxusCertRenewal Invoke-CRVspcApi {
            if ($Method -eq 'PUT') { throw 'VSPC API PUT -> HTTP 400' }
            [pscustomobject]@{ data = [pscustomobject]@{ thumbprint = 'SECTIGO' } }
        }
        { Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -Confirm:$false } | Should -Throw '*Nothing was changed; still SECTIGO*'
        $script:restarts | Should -Be 0
    }
    It 'honours -WhatIf' {
        Set-CRVspcServerCertificate -Thumbprint 'LE2' -Domain 'vspc.axusbackups.com' -AllowSwitchFromNonLE -WhatIf | Should -BeFalse
        $script:puts.Count | Should -Be 0; $script:restarts | Should -Be 0
    }
}

Describe 'Get-CRVspcAgentHealth' {
    It 'counts connection states across pages' {
        Mock -ModuleName AxusCertRenewal Invoke-CRVspcApi {
            if ($Path -like '*offset=0') { [pscustomobject]@{ data = @(1..500 | ForEach-Object { [pscustomobject]@{ connectionStatus = 'Online' } }) } }
            else { [pscustomobject]@{ data = @([pscustomobject]@{ connectionStatus = 'Rejected' }, [pscustomobject]@{ connectionStatus = 'Inaccessible' }) } }
        }
        $h = Get-CRVspcAgentHealth
        $h.Total | Should -Be 502; $h.Online | Should -Be 500; $h.Rejected | Should -Be 1
    }
}

Describe 'Invoke-CRVspcHttp' {
    It 'sends the JSON body from a file (quotes intact) and the key only on stdin, then deletes the file' {
        $script:captured = $null
        function global:curl.exe { $script:capturedArgs = $args; $f = ($args | Where-Object { "$_" -like '@*' -and "$_" -ne '@-' }) -replace '^@', ''; $script:captured = Get-Content -Raw $f; $script:bodyPath = $f; "{}`n200" }
        try {
            $r = Invoke-CRVspcHttp -Method PUT -Path '/configuration/certificates/console' -Body '{"thumbprint":"ABC"}' -ApiKey 'k-123'
            $r.Status | Should -Be 200
            $script:captured | Should -Be '{"thumbprint":"ABC"}'
            ($script:capturedArgs -join ' ') | Should -Not -Match 'k-123'
            Test-Path $script:bodyPath | Should -BeFalse
        } finally { Remove-Item function:global:curl.exe -ErrorAction SilentlyContinue }
    }
}
