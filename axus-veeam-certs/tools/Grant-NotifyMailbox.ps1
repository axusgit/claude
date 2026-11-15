#Requires -Version 5.1
<#
.SYNOPSIS
  One-time, run on the admin workstation. Lets the VSPC and VCC VMs' managed identities send e-mail
  through Microsoft Graph AS ONE MAILBOX ONLY (default service@axustechnologies.com), using
  Exchange Online "RBAC for Applications" (role "Application Mail.Send" + a management scope).

  Deliberately does NOT grant the Entra (tenant-wide) Mail.Send app role: Microsoft documents that
  Entra grants and Exchange RBAC grants are additive, so an Entra grant would let the VMs send as
  anyone. https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac

  Needs: az login (to read the VMs' identity IDs) and an Exchange Administrator sign-in when
  Connect-ExchangeOnline opens the browser. Idempotent. Stores nothing; no secrets.

.EXAMPLE
  .\tools\Grant-NotifyMailbox.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Mailbox = 'service@axustechnologies.com',
    [string]$ResourceGroup = 'USEAST2RG01',
    [string[]]$VmName = @('axususeast2srv1', 'axususeast2srv2'),
    [string]$ScopeName = 'Axus CertRenewal sender',
    [string]$ControlMailbox   # optional: a different mailbox that must test as NOT in scope
)
$ErrorActionPreference = 'Stop'
$azDir = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin'
if (-not (Get-Command az -ErrorAction SilentlyContinue) -and (Test-Path $azDir)) { $env:Path += ";$azDir" }

# 1. Managed identity IDs (Enterprise application: AppId + ObjectId), read live, never written down.
$ids = foreach ($vm in $VmName) {
    $objId = az vm show -g $ResourceGroup -n $vm --query identity.principalId -o tsv
    if (-not $objId) { throw "VM $vm has no system-assigned managed identity." }
    $appId = az ad sp show --id $objId --query appId -o tsv
    if (-not $appId) { throw "Could not read the service principal for $vm." }
    [pscustomobject]@{ Vm = $vm; ObjectId = $objId; AppId = $appId }
}
"Managed identities found: $(($ids | ForEach-Object Vm) -join ', ')"

# 2. Exchange Online (browser sign-in as an Exchange Administrator).
Import-Module ExchangeOnlineManagement -ErrorAction Stop
Connect-ExchangeOnline -ShowBanner:$false

try {
    $mbx = Get-EXOMailbox -Identity $Mailbox -ErrorAction Stop
    "Sender mailbox: $($mbx.PrimarySmtpAddress)"

    # 3. Management scope = exactly this one mailbox.
    $filter = "PrimarySmtpAddress -eq '$($mbx.PrimarySmtpAddress)'"
    $scope = Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue
    if (-not $scope) {
        if ($PSCmdlet.ShouldProcess($ScopeName, "New-ManagementScope ($filter)")) {
            $scope = New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter $filter
            "Created management scope '$ScopeName'"
        }
    } elseif ($scope.RecipientFilter -ne $filter) {
        throw "Scope '$ScopeName' exists with a different filter: $($scope.RecipientFilter). Not changing it."
    } else { "Management scope '$ScopeName' already present" }

    foreach ($i in $ids) {
        # 4. Exchange pointer to the Entra service principal.
        $sp = Get-ServicePrincipal -Identity $i.ObjectId -ErrorAction SilentlyContinue
        if (-not $sp -and $PSCmdlet.ShouldProcess($i.Vm, 'New-ServicePrincipal')) {
            $sp = New-ServicePrincipal -AppId $i.AppId -ObjectId $i.ObjectId -DisplayName "Axus CertRenewal $($i.Vm)"
            "Created Exchange service principal for $($i.Vm)"
        }
        # 5. Application Mail.Send, scoped to the one mailbox.
        $existing = Get-ManagementRoleAssignment -Role 'Application Mail.Send' -ErrorAction SilentlyContinue |
            Where-Object { "$($_.RoleAssignee)" -eq "$($sp.Identity)" -or "$($_.RoleAssigneeName)" -eq $i.ObjectId -or "$($_.RoleAssigneeName)" -eq "$($sp.DisplayName)" }
        if (-not $existing -and $PSCmdlet.ShouldProcess($i.Vm, "Assign 'Application Mail.Send' scoped to '$ScopeName'")) {
            New-ManagementRoleAssignment -App $i.ObjectId -Role 'Application Mail.Send' -CustomResourceScope $ScopeName | Out-Null
            "Assigned Application Mail.Send (scope '$ScopeName') to $($i.Vm)"
        } elseif ($existing) { "Mail.Send assignment already present for $($i.Vm)" }

        # 6. Test (bypasses the 30 min - 2 h permission cache).
        $t = Test-ServicePrincipalAuthorization -Identity $i.ObjectId -Resource $mbx.PrimarySmtpAddress | Where-Object RoleName -eq 'Application Mail.Send'
        "$($i.Vm): Mail.Send as $($mbx.PrimarySmtpAddress) InScope=$($t.InScope)"
        if ($ControlMailbox) {
            $c = Test-ServicePrincipalAuthorization -Identity $i.ObjectId -Resource $ControlMailbox | Where-Object RoleName -eq 'Application Mail.Send'
            "$($i.Vm): Mail.Send as $ControlMailbox InScope=$($c.InScope)  (expected False)"
        }
    }
} finally {
    Disconnect-ExchangeOnline -Confirm:$false | Out-Null
}

# 7. Make sure no tenant-wide Entra Mail.Send grant exists on the identities (would defeat the scope).
foreach ($i in $ids) {
    $grants = az rest --method GET --url "https://graph.microsoft.com/v1.0/servicePrincipals/$($i.ObjectId)/appRoleAssignments" --query "value[].appRoleId" -o tsv 2>$null
    "$($i.Vm): Entra app-role grants on the identity: $(@($grants | Where-Object { $_ }).Count) (expected 0)"
}
'Done. Exchange may take 30 minutes to 2 hours before the VMs can actually send.'
