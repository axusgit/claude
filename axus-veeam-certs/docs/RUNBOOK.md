# RUNBOOK: Let's Encrypt automation for the Axus Veeam servers

| Server | VM | Role of the cert | Bind |
|---|---|---|---|
| `vspc.axusbackups.com` | `axususeast2srv1` (VSPC 9.3.0.35057) | VSPC **Web UI** (IIS :1280) | **Automatic** after the first, human-approved switch (HTTP.sys binding swap + IIS site restart, auto-rollback) |
| `vcc.axusbackups.com` | `axususeast2srv2` (VBR 13.1.0.411) | Cloud Connect **gateway** | **Automatic** after the first, human-approved switch |
| `vspc.axusbackups.com` | `axususeast2srv1` | VSPC **Server** cert (management agents) | **Manual install** at each renewal (e-mailed click steps); see 5a-2 and Veeam case #08312917 |

All three run on Let's Encrypt since 2026-11-14 (current certs expire 2027-02-12 07:32 ET; renewal ~mid-January).

Both servers run Eastern time. Resource group `USEAST2RG01`; DNS zone `axusbackups.com` in `useast2rg01`.
Current state of every cert: [INVENTORY.md](INVENTORY.md).

**Hard rules:** staging before production; no script defaults to production; Sectigo certs are never
deleted or modified; no bind or Veeam service/IIS restart without an agreed time window; no stored
secrets (managed identity only); verify by outcome, not by TLS probes against the VCC gateway.

**Open items**
- [ ] Check the Sectigo certificates (VSPC `498F73A3...` expiring 2026-12-12, VCC `FFDC859C...` expiring
      2027-02-18) do **not** have auto-renew enabled in the Sectigo / reseller account, so they are not
      renewed and billed. Let them expire; do not delete them from the servers (they stay as rollback until expiry).
- [ ] Veeam case #08312917: API sign-in that survives a Server-cert change (unattended Server-cert renewal).
- [ ] Mid-January 2027: install the renewed VSPC Server cert when the e-mail arrives (before 2027-02-12 07:32 ET).

---

## 1. How it works

```
daily task (SYSTEM) ─► Invoke-Vspc/VccRenewal.ps1 ─► Posh-ACME Submit-Renewal
                                                     │  (only acts inside the renewal window,
                                                     │   ARI-guided, ~1/3 of lifetime before expiry)
                                                     ├─► Azure plugin, AZUseIMDS ─► VM managed identity
                                                     │     ─► _acme-challenge TXT in Azure DNS
                                                     └─► new cert (RSA 4096, classic profile, new key)
                                                          installed in LocalMachine\My
VCC : Set-CRVccCertificate ─► Get-VBRCloudGatewayCertificate -FromStore ─► Add-VBRCloudGatewayCertificate
VSPC: Set-CRVspcWebUiCertificate ─► netsh http update sslcert 0.0.0.0:1280 (all settings copied)
      ─► restart IIS site ─► verify served cert + settings ─► automatic rollback on any failure
both: expiry guard, warns when the *bound* cert has < 21 days left (error < 7)
```

Files on each server (all under ACL SYSTEM + Administrators):

| Path | What |
|---|---|
| `C:\ProgramData\Axus\CertRenewal\bin\` | `AxusCertRenewal.psm1`, `Invoke-*Renewal.ps1`, `Register-CertRenewalTask.ps1` |
| `C:\ProgramData\Axus\CertRenewal\config.json` | Role, Domain, NotifyFrom/To, BindWindow, WarnDays (no secrets) |
| `C:\ProgramData\Axus\CertRenewal\logs\` | `vspc-YYYYMMDD.log` / `vcc-YYYYMMDD.log` (full detail) |
| `C:\ProgramData\Axus\CertRenewal\status-<role>.json` | Last run result (what §8 checks) |
| `C:\ProgramData\Posh-ACME\` | `POSHACME_HOME`: ACME account, orders, keys, PFX |
| Event Log | Application, source `AxusCertRenewal`: 1000 info, 2000 warning, 3000 error |
| Task | `\Axus\CertRenewal`, daily 02:17 ET, SYSTEM, 2 retries 30 min apart |

Scripts in this repo: `scripts/` (server side), `tools/New-RunCommandPayload.ps1` (packs them for
`az vm run-command`, writes to `payloads/`, which is git-ignored), `tests/` (Pester), `azure/` (role template).

---

## 2. Prerequisites (once)

Workstation:
```powershell
az login                                     # Axus tenant
az account set --subscription "Microsoft Partner Network"
cd C:\Users\Andy\UsersAndyaxus-claude\axus-veeam-certs
```

Per server (each line is a change, approve individually):

1. **System-assigned managed identity**
   ```powershell
   az vm identity assign -g USEAST2RG01 -n <vm>
   ```
2. **Custom role** (once for both VMs). Least privilege, verified against the plugin source: it only
   lists zones (`GET .../providers/Microsoft.Network/dnszones`) and GET/PUT/DELETEs TXT record sets
   (api-version 2018-05-01). Posh-ACME's docs build the role from "DNS Zone Contributor" and keep extras
   (alert rules, deployments, resource-group read) that the plugin never calls; we drop them.
   ```powershell
   $sub = az account show --query id -o tsv
   $tmp = Join-Path $env:TEMP 'dns-txt-role.json'
   (Get-Content .\azure\dns-txt-contributor.role.json -Raw).Replace('{{SUBSCRIPTION_ID}}', $sub) | Set-Content $tmp
   az role definition create --role-definition "@$tmp"; Remove-Item $tmp
   ```
3. **Role assignment, scoped to the zone only**
   ```powershell
   $miId = az vm show -g USEAST2RG01 -n <vm> --query identity.principalId -o tsv
   $zone = az network dns zone show -g useast2rg01 -n axusbackups.com --query id -o tsv
   az role assignment create --assignee-object-id $miId --assignee-principal-type ServicePrincipal `
      --role "DNS TXT Contributor (Axus ACME)" --scope $zone
   ```
   RBAC can take up to ~10 minutes to apply. If the staging pass reports the zone is not found, wait and retry.
   Fallback only if it persists: scope the same role to the resource group `useast2rg01`
   (still TXT-only; that RG holds only this one zone).
4. **E-mail notifications.** Sending uses Microsoft Graph with the VM's managed identity, so no password is
   stored. Exchange Online *RBAC for Applications* lets the identity send **only** as the chosen mailbox
   (no tenant-wide Entra grant). Steps are in §9. Without it the scripts log
   "E-mail not configured" and rely on the Event Log + the expiry guard.
5. **Setup on the server** (folders + ACL, `POSHACME_HOME`, NuGet provider, Posh-ACME 4.35.0, event source,
   scripts, config). Idempotent; contacts nobody but PSGallery.
   ```powershell
   .\tools\New-RunCommandPayload.ps1 -Name vspc-setup -Command Initialize -Arguments @{
       Role = 'VSPC'; Domain = 'vspc.axusbackups.com' }        # add NotifyFrom / NotifyTo when §9 is done
   az vm run-command invoke -g USEAST2RG01 -n axususeast2srv1 --command-id RunPowerShellScript --scripts "@payloads/vspc-setup.ps1"
   ```
   Expect `Managed identity token: OK`, `Posh-ACME loadable: yes` (VCC also: `pwsh: Posh-ACME + Veeam module OK`).

**VCC only, before the first switch:** Let's Encrypt certs chain to *ISRG Root X1*. Every tenant's VBR
server must trust that root (present in the Windows root store and normally fetched automatically; it can be
missing where automatic root updates are disabled by policy). Check on a tenant VBR server with
`Get-ChildItem Cert:\LocalMachine\Root | ? Subject -like '*ISRG Root X1*'`, or confirm with the tenant.

---

## 3. Staging pass (always first)

Staging certs are **never installed** into the machine store, so nothing can bind them.
```powershell
.\tools\New-RunCommandPayload.ps1 -Name vspc-staging -Command VspcRenewal -Arguments @{ Environment = 'Staging'; NewOrder = $true }
az vm run-command invoke -g USEAST2RG01 -n axususeast2srv1 --command-id RunPowerShellScript --scripts "@payloads/vspc-staging.ps1"
```
(VCC: `-Command VccRenewal`, `-n axususeast2srv2`.)

Pass criteria: output contains `Issued vspc.axusbackups.com -> <thumbprint>` and `EXIT: 0`.
Then prove the renewal path too (forces a re-issue on staging only):
```powershell
.\tools\New-RunCommandPayload.ps1 -Name vspc-staging-renew -Command VspcRenewal -Arguments @{ Environment = 'Staging'; ForceRenew = $true }
```
If it fails, read the log on the server (`logs\vspc-YYYYMMDD.log`) and see §6.

## 4. Production issue

Same command with `Environment = 'Production'; NewOrder = $true`. This creates the production ACME account
(no contact e-mail; we monitor ourselves) and installs the cert into `LocalMachine\My` with friendly name
`LetsEncrypt <domain>`. It **does not bind** anything. Note the thumbprint from the output.

Rate limits: Let's Encrypt allows 5 duplicate certificates per week per exact name set, so do not loop
production issues. Use staging for retries.

## 5. Bind

### 5a. VSPC Web UI (first switch: one command, in a window you choose)

Veeam documents two ways to set the Web UI certificate: the console wizard (Configuration > Certificates >
Install > Web UI) and port bindings in IIS Manager, followed by an IIS site restart
([Configuring Web UI Certificate](https://helpcenter.veeam.com/docs/vac/provider_admin/configure_web_ui_certificate.html)).
On `axususeast2srv1` the Web UI thumbprint lives **only** in the HTTP.sys SSL binding `0.0.0.0:1280`
(checked 2026-11-14: not in `applicationHost.config`, the `HKLM\SOFTWARE\Veeam\VAC` key, or config files).

`Set-CRVspcWebUiCertificate` does what the wizard does:
1. safety checks (prod LE, SAN, key, >= 7 days; first switch from Sectigo needs `-AllowSwitchFromNonLE`;
   afterwards only a later-expiring LE cert);
2. `netsh http update sslcert ipport=0.0.0.0:1280` with the new hash and **every other setting copied**
   (a plain update resets *DS Mapper Usage* to Disabled; verified on the server);
3. restarts the IIS site `Veeam Availability Console Web UI` (a few seconds; portal users log in again;
   management agents and backups are not affected);
4. verifies HTTP.sys holds the new hash, all settings are unchanged, and a TLS handshake to
   `127.0.0.1:1280` (SNI `vspc.axusbackups.com`) returns the new cert;
5. on any failure: puts the previous cert back the same way, restarts, verifies, and raises an error.

Rehearsed on the server 2026-11-14 on a throw-away port (44399, HttpListener): switch verified, settings
identical, rollback verified, test binding removed; port 1280 untouched.

```powershell
.\tools\New-RunCommandPayload.ps1 -Name vspc-bind -Command VspcRenewal -Arguments @{
    Environment = 'Production'; BindThumbprint = '<prod thumbprint>'; AllowSwitchFromNonLE = $true }
az vm run-command invoke -g USEAST2RG01 -n axususeast2srv1 --command-id RunPowerShellScript --scripts "@payloads/vspc-bind.ps1"
```
Expect `Bind verified: Web UI serves <thumbprint>` and `EXIT: 0`. Then verify by outcome (§5c).

After the first switch, the daily task (`-AutoBind`) binds future renewals itself, under the same rules as
VCC: only when the Web UI already has a Let's Encrypt cert, the new one expires later, and the time is inside
`BindWindow` (default 01:00-05:00 ET; task runs 02:17).

Console alternative (same result, by hand): Configuration > Certificates > Install > Web UI > select the cert
from the store > local admin credentials > Finish; then IIS Manager > Sites > "Veeam Availability Console
Web UI" > Restart.

### 5a-2. VSPC Server certificate (management agents)

The VSPC **Server** certificate is what management agents trust. It was Sectigo `498F73A3...` (expiring
2026-12-12), not the Veeam self-signed cert the registry suggests. Trust the console (Configuration >
Certificates), not `HKLM\SOFTWARE\Veeam\VAC\ServerCommunicationCertificate`.

Switched to Let's Encrypt `8124E914...` on 2026-11-14 14:34 via the REST API
(`PUT /api/v3/configuration/certificates/console` `{ "thumbprint": "..." }`) plus a restart of
*Veeam Management Portal*. Result: all 40 agents reconnected within ~6 minutes; VSPC logged
`JWT signing certificate has been updated` and started a CertificateDeploymentTask to the agents.

**Learned:** VSPC signs its API keys and login tokens with the Server certificate. Changing the Server
cert invalidates every Simple API key (`JwTokenIssuer ... invalid signature`) and logs out console
sessions. So a Simple key can perform at most one Server-cert change. Unattended renewal needs a
credential that survives the change (Advanced key / `grant_type=public_key`, undocumented; asked in
the Veeam case). Until then:
- the nightly task records the Server cert it last installed (`vspc-server-thumbprint.txt`), warns
  when it has < 21 days, and e-mails click steps when a newer cert is waiting;
- install by hand: Configuration > Certificates > Install > Server > newest `LetsEncrypt vspc...` >
  Finish, then restart *Veeam Management Portal* (or via run-command). Agents reconnect on their own.

### 5b. VCC gateway (first switch: manual, in a window you choose)

Uses Veeam's documented cmdlets (VBR 13: [Add-VBRCloudGatewayCertificate](https://helpcenter.veeam.com/docs/vbr/powershell/add-vbrcloudgatewaycertificate.html),
`Get-VBRCloudGatewayCertificate -FromStore`). The script refuses to replace a non-Let's Encrypt cert unless
`-AllowSwitchFromNonLE` is given, refuses staging/wrong-SAN/near-expiry certs, and verifies afterwards.
```powershell
.\tools\New-RunCommandPayload.ps1 -Name vcc-bind -Command VccRenewal -Arguments @{
    Environment = 'Production'; BindThumbprint = '<prod thumbprint>'; AllowSwitchFromNonLE = $true }
az vm run-command invoke -g USEAST2RG01 -n axususeast2srv2 --command-id RunPowerShellScript --scripts "@payloads/vcc-bind.ps1"
```
After the first switch, the daily task (`-AutoBind`) binds future renewals itself, but only when the gateway
already has a Let's Encrypt cert, the new one expires later, and the time is inside `BindWindow`
(default 01:00-05:00 ET; task runs 02:17).

### 5c. Verification (by outcome)

VSPC:
- Browser on `https://vspc.axusbackups.com:1280`: padlock shows issuer *Let's Encrypt*, new expiry.
- The certificate-expiry alert shown at login is gone.
- Management agents still **Healthy** in the VSPC console (the Web UI change should not affect them; check anyway).
- `Configuration > Certificates` shows the new Web UI certificate.

VCC:
- Next **tenant backup job completes** (check in VBR console on `axususeast2srv2` > Cloud Connect > tenants'
  last activity, or ask a tenant). Do not judge by `openssl s_client` / TLS probes against the gateway.
- `status-vcc.json` shows `BoundThumbprint` = new thumbprint.

---

## 6. When a renewal fails

You get an Event Log error (ID 3000) and, if configured, an e-mail "certificate renewal FAILED".
There is time: renewal starts about 30 days before expiry (90-day certs) and retries daily, and the expiry
guard warns at 21 days.

1. Read `C:\ProgramData\Axus\CertRenewal\logs\<role>-YYYYMMDD.log` (via run-command:
   `Get-Content C:\ProgramData\Axus\CertRenewal\logs\vcc-*.log -Tail 60`).
2. Common causes:
   | Symptom in log | Fix |
   |---|---|
   | `No managed identity token` | Identity disabled or VM re-created: §2 step 1 + 3 |
   | `zone not found` / 403 on TXT | Role assignment missing or still propagating: §2 step 3 |
   | `Could not read subscription ID from IMDS` | IMDS blocked (firewall/proxy on 169.254.169.254) |
   | ACME `rateLimited` | Wait for the window in the error; don't retry production in a loop |
   | ACME `unauthorized`/`incorrect TXT` | Check DNS: `Resolve-DnsName _acme-challenge.<domain> -Type TXT`; CAA added since? It must allow `letsencrypt.org` |
   | `Refusing to bind` | The safety check worked; read the reasons; nothing was changed |
   | `Bind verification failed` | Gateway reports a different cert; check VBR console; rollback §7 if tenants fail |
   | `VSPC Web UI bind of ... failed (...); rolled back to ... (verified)` | Web UI is back on the previous cert; read the log for the cause; nothing else changed |
   | `...; rollback failed` | Portal may be on no/wrong cert: bind by hand via the console (§5a) right away |
3. Re-run by hand after fixing: staging first if the cause was DNS/identity, then production renewal
   (no `-NewOrder`).

## 7. Rollback to the Sectigo certificate

Sectigo certs are never touched, so rollback is just re-binding them while they are valid:

| Server | Sectigo thumbprint | Valid until |
|---|---|---|
| VSPC Web UI | `498F73A3836D3BD7973A477759F01610BC190140` | **2026-12-12** |
| VCC gateway | `FFDC859C01F39D21F8EAC2D6515A037FCC4E5529` | 2027-02-18 |

- **VSPC:** while it is valid, the console alternative in §5a with the Sectigo cert (the script's guard
  intentionally won't bind a non-LE cert). Auto-bind then stops on its own.
- **VCC** (in pwsh 7 on the server, via run-command; the script's guard intentionally won't do this):
  ```powershell
  Import-Module Veeam.Backup.PowerShell -DisableNameChecking
  $c = Get-VBRCloudGatewayCertificate -FromStore | Where-Object Thumbprint -eq 'FFDC859C01F39D21F8EAC2D6515A037FCC4E5529'
  Add-VBRCloudGatewayCertificate -Certificate $c
  ```
  Auto-bind then stops on its own (it only replaces a Let's Encrypt cert). Optionally disable the task:
  `Disable-ScheduledTask -TaskPath '\Axus\' -TaskName CertRenewal`.

After those dates there is no fallback cert: go/no-go for VSPC is **2026-12-01**, leaving time to buy a
Sectigo renewal if Let's Encrypt is not in place.

## 8. Checking that the daily task ran

```powershell
$chk = @'
$t = Get-ScheduledTask -TaskPath '\Axus\' -TaskName CertRenewal; $i = $t | Get-ScheduledTaskInfo
"Task: $($t.State) last=$($i.LastRunTime) result=$($i.LastTaskResult) next=$($i.NextRunTime)"
Get-Content C:\ProgramData\Axus\CertRenewal\status-*.json -Raw
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='AxusCertRenewal'; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 5 -EA SilentlyContinue | ft TimeCreated,Id,LevelDisplayName -AutoSize | Out-String
'@
Set-Content -Path "$env:TEMP\chk.ps1" -Value $chk
az vm run-command invoke -g USEAST2RG01 -n axususeast2srv2 --command-id RunPowerShellScript --scripts "@$env:TEMP\chk.ps1" --query "value[0].message" -o tsv
```
`result=0` is success; `Result: OK` in the status file; `Action` is `NotDue` on most days.

## 9. E-mail via Graph with the managed identity

What is sent (to `NotifyTo`, from `NotifyFrom`; both `service@axustechnologies.com`):
every renewal (new cert, whether it was bound, what is in use now), every bind, every failure,
"ready to bind" while a first switch is pending, and expiry warnings (< 21 days; error < 7).
Everything also goes to the Application event log (source `AxusCertRenewal`).

Permission model: Exchange Online **RBAC for Applications**, role `Application Mail.Send`, scoped by a
management scope to the one sender mailbox. **No** Entra (tenant-wide) `Mail.Send` grant: Microsoft
documents that Entra and Exchange RBAC grants are additive, so an Entra grant would let the VMs send as
anyone ([RBAC for Applications](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)).

1. On the workstation, signed in to az, run (browser sign-in as Exchange Administrator; idempotent):
   ```powershell
   .\tools\Grant-NotifyMailbox.ps1 -ControlMailbox <any other mailbox>
   ```
   Expect `InScope=True` for service@, `InScope=False` for the control mailbox, `Entra app-role grants: 0`.
   Exchange caches app permissions for 30 minutes to 2 hours.
2. Re-run setup on each server with the addresses (writes them to `config.json`):
   ```powershell
   .\tools\New-RunCommandPayload.ps1 -Name vspc-setup -Command Initialize -Arguments @{
       Role = 'VSPC'; Domain = 'vspc.axusbackups.com'
       NotifyFrom = 'service@axustechnologies.com'; NotifyTo = @('service@axustechnologies.com') }
   ```
3. Send a test e-mail from each server (via run-command):
   ```powershell
   Import-Module C:\ProgramData\Axus\CertRenewal\bin\AxusCertRenewal.psm1
   $cfg = Get-CRConfig -Path C:\ProgramData\Axus\CertRenewal\config.json
   Send-CRNotification -Config $cfg -Subject 'Test: certificate renewal e-mail' -Body 'Test from the renewal scripts.'
   ```

## 10. Research notes and sources

- Posh-ACME Azure plugin: `AZSubscriptionId` + `AZUseIMDS` for managed identity; zone discovery lists all
  zones in the subscription; TXT add/remove via ARM api-version 2018-05-01.
  [poshac.me Azure plugin guide](https://poshac.me/docs/latest/Plugins/Azure/),
  [plugin source](https://github.com/rmbolger/Posh-ACME/blob/main/Posh-ACME/Plugins/Azure.ps1).
- `New-PACertificate`: `-CertKeyLength 4096`, `-AlwaysNewKey`, `-Profile`, `-Install` (needs elevation; LocalMachine\My),
  `-FriendlyName`. [docs](https://poshac.me/docs/latest/Functions/New-PACertificate/). Posh-ACME 4.35.0
  (PSGallery, 2026-10-12, min PowerShell 5.1). `Submit-Renewal` re-uses saved order settings including `Install`
  and returns nothing when not yet due (verified in module source).
- VSPC certificates: Web UI cert = browsers + REST clients; Server cert = management agents.
  [VSPC certificates](https://helpcenter.veeam.com/docs/vac/deployment/vspc_certificates.html),
  [Web UI procedure](https://helpcenter.veeam.com/docs/vac/provider_admin/configure_web_ui_certificate.html),
  [Server procedure](https://helpcenter.veeam.com/docs/vac/provider_admin/configure_server_certificate.html)
  (Server: install, then restart *Veeam Management Portal* service; RSA 4096 recommended; EKU Server Auth).
- VSPC REST API v3.6: **no Web UI certificate endpoint**. It does have
  `GET /configuration/certificates`, `GET|PUT /configuration/certificates/console` ("Installs a Veeam Service
  Provider Console server security certificate", body `{ "thumbprint": "..." }`), i.e. the **Server** role.
  Source: OpenAPI 3.6 definition (VSPC 9.2) as published in
  [shellrent/veeam-vspc-api-client](https://github.com/shellrent/veeam-vspc-api-client/blob/master/openapi/3.6/vspc-api.json);
  Veeam's own [REST reference](https://helpcenter.veeam.com/docs/vac/rest/reference/vspc-rest.html) should be
  checked for 9.3 before use. Using it needs a VSPC API key (a stored secret), and Veeam does not document how
  agents react to a Server-cert change, so this is in the support case (Veeam case #08312917, see VEEAM-SUPPORT-CASE.md).
- VBR 13 Cloud Connect: `Add-VBRCloudGatewayCertificate -Certificate <VBRCloudCertificate>` with
  `Get-VBRCloudGatewayCertificate -FromStore`. The page does not state tenant impact or service restarts, which is
  why the first switch is done in a chosen window and verified by a completed tenant job.
