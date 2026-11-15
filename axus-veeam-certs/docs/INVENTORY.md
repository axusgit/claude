# Inventory: Veeam TLS certificate servers

Collected 2026-11-14 (read-only) with `scripts/Get-CertInventory.ps1` via `az vm run-command`.
Subscription IDs and identity object IDs are intentionally not recorded here.

## Azure resources

| Role | VM | Resource group | Region | Size | Public IP | Managed identity |
|---|---|---|---|---|---|---|
| VSPC (`vspc.axusbackups.com`) | `axususeast2srv1` | `USEAST2RG01` | eastus2 | Standard_B4ms | 172.206.40.229 | **none** |
| VCC (`vcc.axusbackups.com`) | `axususeast2srv2` | `USEAST2RG01` | eastus2 | Standard_D8as_v4 | 20.161.33.126 | **none** |

Subscription: "Microsoft Partner Network" (tenant Axus Technologies).

### DNS zone `axusbackups.com` (resource group `useast2rg01`)

| Record | Type | Value |
|---|---|---|
| `vspc` | A | 172.206.40.229 |
| `vcc` | A | 20.161.33.126 |
| `_0402b78c…vspc` | CNAME | Sectigo DCV (leftover) |
| `_92748c4d…vcc` | CNAME | Sectigo DCV (leftover) |
| `_92748c4d…vcc.axusbackups.com` | CNAME | Sectigo DCV, mistakenly double-suffixed (leftover) |
| `@` | NS / SOA / MX | |

- **CAA: none.** Any CA, including Let's Encrypt, may issue. (If CAA is added later, it must include `letsencrypt.org`.)
- Leftover Sectigo DCV CNAMEs are harmless and are not to be touched by this project.

## VSPC: `axususeast2srv1`

| Item | Value |
|---|---|
| OS | Windows Server 2022 Datacenter, build 20348 |
| Windows PowerShell | 5.1.20348.5756 |
| PowerShell 7 | **not installed** |
| .NET Framework 4 release | 528449 (4.8) |
| PowerShellGet / NuGet provider | 1.0.0.1 / **none** (Posh-ACME install must bootstrap NuGet or use an offline copy) |
| Posh-ACME | not installed |
| Veeam | Service Provider Console **9.3.0.35057** (Application Server + WebUI); Updater plug-in 9.3.0.35061 |
| Outbound 443 | LE prod OK, LE staging OK, management.azure.com OK; IMDS reachable (200) |

### Certificates in LocalMachine\My (public CA only; 15 self-signed/Veeam/Azure-CRP certs omitted)

| Thumbprint | Expires | Private key | Key | Issuer | SAN | In use |
|---|---|---|---|---|---|---|
| `498F73A3836D3BD7973A477759F01610BC190140` | **2026-12-12** | yes | RSA 4096 | Sectigo DV R36 | vspc, www.vspc | **Web UI (IIS :1280)** |
| `382BF2AE90781AA887589954D744EF47499A999F` | 2026-08-17 (expired) | yes | RSA 4096 | Sectigo DV R36 | vcc, www.vcc | no |
| `213810027328A9879FC61D048E52CDA015145458` | 2025-12-07 (expired) | yes | RSA 4096 | Sectigo RSA DV | vspc, www.vspc | no |
| `49AE7D6B0C0A11B4CA10C22A3755943B3B04D2B5` | 2025-12-07 (expired) | **no** | RSA 4096 | Sectigo RSA DV | vspc, www.vspc | no |

### Bindings and roles

| Where | Port | Certificate |
|---|---|---|
| IIS site "Veeam Availability Console Web UI" (https) | 1280 | `498F73A3…` Sectigo (HTTP.sys binding matches) |
| IIS "Default Web Site" | 80 (http) | n/a |
| HTTP.sys | 33034 | `1FF57C43…` Veeam Backup Server Certificate (self-signed, internal) |
| **VSPC "Server" role** (agents) | 6180 / 9999 | **CORRECTED 2026-11-14:** VSPC console (Configuration > Certificates) shows Type *Server* = `VSPC SSL 2025`, Sectigo `498F73A3…`, **expires 2026-12-12**; a management agent (VM-ARMS-DC1) shows the same cert. The registry value `ServerCommunicationCertificate` = `56ED557D…` (Veeam self-signed, 2033) is NOT what the console reports; logs show it as an internal communication cert. |
| Veeam Updater | n/a | `45BEBA16…` self-signed |

Listening: 1280 System (HTTP.sys), 1989 Veeam.MBP.Service, 6180 VeeamGateSvc, 9999 Veeam.Portal.ConnectionHub.

Services: all Veeam services Running/Automatic, including VeeamManagementPortalSvc,
VeeamGateSvc (VSPC's own cloud gateway for management agents), VeeamAgentRoutingSvc,
ConnectWise Manage plugin (+ web UI), Agent Self-Service Recovery Portal.

## VCC: `axususeast2srv2`

| Item | Value |
|---|---|
| OS | Windows Server 2022 Datacenter, build 20348 |
| Windows PowerShell | 5.1.20348.5756 |
| PowerShell 7 | 7.6.3 (`C:\Program Files\PowerShell\7\pwsh.exe`) |
| .NET Framework 4 release | 528449 (4.8) |
| PowerShellGet / NuGet provider | 1.0.0.1 / **none** |
| Posh-ACME | not installed |
| Veeam | Backup & Replication Server + Console **13.1.0.411** (brief said 13.0.1; actual is 13.1); VSPC Management Agent 9.3.0.35057 |
| Cloud Connect | 1 gateway (`axususeast2srv2`, enabled, NAT, DNS `vcc.axusbackups.com`); **6 tenants** |
| Outbound 443 | LE prod OK, LE staging OK, management.azure.com OK; IMDS reachable (200) |

### Certificates in LocalMachine\My (public CA only; 46 self-signed/Veeam certs omitted)

| Thumbprint | Expires | Private key | Key | Issuer | SAN | In use |
|---|---|---|---|---|---|---|
| `FFDC859C01F39D21F8EAC2D6515A037FCC4E5529` | **2027-02-18** | yes | RSA 4096 | Sectigo DV R36 | vcc, www.vcc | **Cloud gateway** (`Get-VBRCloudGatewayCertificate`) |
| `382BF2AE90781AA887589954D744EF47499A999F` | 2026-08-17 (expired) | yes | RSA 4096 | Sectigo DV R36 | vcc, www.vcc | no |

HTTP.sys: 33034 and 9419 (VBR REST API) use `5C69A4BB…` (VBR internal cert, not in scope).

Services: all Veeam services Running/Automatic except VeeamMBPDeploymentService (Stopped/Manual, normal).

## Findings that affect the plan

1. **Neither VM has a managed identity yet.** Enabling it is step 5/6.
2. **No NuGet provider on either server.** `Install-Module Posh-ACME` will need the NuGet
   provider bootstrapped (TLS 1.2) first, or Posh-ACME copied in as a saved module.
3. **VSPC has no PowerShell 7.** Fine for Posh-ACME (supports Windows PowerShell 5.1).
4. **CORRECTED 2026-11-14: the VSPC "Server" role uses the Sectigo cert `498F73A3…` (expires
   2026-12-12)**, the same cert the Web UI used. The original finding (self-signed, from the registry)
   was wrong; the VSPC console and a management agent both show Sectigo. It must be replaced before
   2026-12-12. Let's Encrypt `8124E914…` matches it on key (RSA 4096), KU (DigitalSignature,
   KeyEncipherment), EKU (Server Authentication) and CN; differs in root (ISRG Root X1 vs USERTrust) and
   has no `www.` SAN.
5. **Sectigo SANs include `www.` names.** The Let's Encrypt certs will cover only
   `vspc.axusbackups.com` / `vcc.axusbackups.com` unless `www.` is requested.
6. VBR is 13.1.0.411, not 13.0.1. Cmdlet references will be checked against v13 docs.
