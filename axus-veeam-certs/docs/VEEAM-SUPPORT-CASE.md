# Veeam support case (VSPC certificate automation)

**Case #08312917** opened 2026-11-14 (Axus Technologies account, my.veeam.com). Status: awaiting Veeam.

**Product:** Veeam Service Provider Console 9.3.0.35057
**Severity:** 3
**Subject:** How to automate VSPC certificate renewal (Let's Encrypt, 90-day certificates)

---

Axus Technologies is a Veeam Cloud & Service Provider. We moved our VSPC server (9.3.0.35057, Windows
Server 2022) to Let's Encrypt certificates, which renew every 90 days. A scheduled task already renews the
certificate and places it in the Windows certificate store. We need a supported way to install it in VSPC
without a person logging in each time.

1. Web UI certificate: is there a supported command or API to install it? If not, is it supported to
   update the HTTPS binding on port 1280 directly and restart the IIS site?

2. Server certificate: we installed a new one with the REST API (PUT /api/v3/configuration/certificates/console)
   and restarted the Veeam Management Portal service. All management agents reconnected, but our REST API
   key stopped working (Server.log: "JwTokenIssuer ... invalid signature"). That means a script can change
   the Server certificate only once. What is the supported way for a script to sign in to the API that keeps
   working after a Server certificate change? Would an Advanced API key work, and where is that documented?

3. Is built-in Let's Encrypt support for VSPC planned?

Thank you,
Axus Technologies

---

Internal notes (do not send):
- Since 2026-11-14 our script automates question 1 (HTTP.sys binding swap on 0.0.0.0:1280 with all settings
  copied, IIS site restart, served-cert check, auto-rollback). If Veeam says it is unsupported, drop
  `-AutoBind` from the VSPC task and bind via the console (RUNBOOK 5a).
- Question 2 is the blocker for unattended Server-cert renewal (next one around mid-January 2027).
- Removed from the earlier draft (ask only if they bring it up): whether agents pin the thumbprint or
  validate the CA chain (they reconnected fine), minimum API key role, whether the ConnectWise Manage
  plugin is re-keyed after a Server cert change.
- Cite: https://helpcenter.veeam.com/docs/vac/provider_admin/configure_web_ui_certificate.html and
  https://helpcenter.veeam.com/docs/vac/provider_admin/configure_server_certificate.html

## Case log

- 2026-11-14 evening: Veeam (support engineer) replied. Web UI: updating the IIS/HTTP.sys binding on 1280 directly
  and restarting the site is the method Veeam recommends for automation (confirms our approach). Server cert: the PUT
  is the right call; API key behaviour after a Server-cert change is undocumented, they asked for key type, auth
  method, fresh-session test, new-key test, exact build, and logs. RSA only (ECDSA breaks VSPC 9 auth); we use RSA 4096.
- Read-only check of Server.log: `14:34:39.9120 JwTokenIssuer: All previous JW tokens were invalidated due
  certificate change.` The Simple key is validated as a JWT, so the Server-cert change invalidates it by design.
  Build confirmed 9.3.0.35057 (the case form showed 35706).
- Logs zipped on the VSPC server: `C:\ProgramData\Axus\CertRenewal\support\VSPC-logs-case-08312917.zip` (5.1 MB:
  Server.log, Server_error.log, AgentAuthorization.log, webUI_error.log, SystemInformation.txt).
- 2026-11-14: Logs uploaded and answers sent. Follow-up sent asking for escalation: Veeam's own REST reference
  (API Key-Based Authorization) says an API key is "a permanent authorization grant" and "is active until the
  associated user identity is disabled or deleted", which contradicts the invalidation on Server-cert change.
  Waiting on Veeam.
- 2026-11-14 evening: Veeam accepted the discrepancy. Reproducing in their lab on the same build: (1) is Simple-key
  invalidation on Server-cert change intended, (2) does an Advanced key survive it, (3) supported unattended sign-in
  method. Will escalate to senior internal resources if reproduced. "This will take some time." Waiting on Veeam.
- 2026-11-15: Veeam status update only. Lab server built, patching; next they install VSPC 9.3.0.35057 and try to
  reproduce, then discuss internally. No answer yet. Waiting on Veeam.
