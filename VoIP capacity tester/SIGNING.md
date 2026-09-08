# Code-signing the probes (clearing the SmartScreen warning)

The Windows probes (`voiptesterprobe.exe`, `voiptesterprobe-cli.exe`) are
unsigned, so Microsoft Defender **SmartScreen** shows *"Windows protected your
PC — unrecognized app"* on first run. This is caused by three things together:
the binary is **unsigned**, it carries the **Mark of the Web** (downloaded from
the internet), and it has **no reputation** yet. Renaming, rebuilding, or the
config trailer do **not** affect it — only an Authenticode signature does.

## What you must obtain (the one thing that isn't automatable)

A **code-signing certificate** from a public CA (DigiCert, Sectigo, SSL.com, …):

| Type | SmartScreen | Cost (approx) | Delivery |
| --- | --- | --- | --- |
| **EV** (Extended Validation) | **Clears instantly** — trusted on first download | ~$250–400/yr | Hardware token or cloud HSM (FIPS) |
| **OV** (Organization Validation) | Reputation **builds up** over downloads (early runs may still warn) | ~$100–250/yr | PFX file or token |

Recommendation: **EV** if techs run this at customer sites regularly — it's the
only option that makes the warning disappear immediately, and it puts
"Axus Technologies" on the publisher line. Both require validating the Axus
business entity with the CA (a few days).

## What's already wired up

Everything else is ready:

- **`build.ps1` signs automatically** when you pass a cert — after building, it
  runs `signtool` on both probe .exes with a SHA-256 signature and an RFC-3161
  timestamp (so signatures stay valid after the cert expires):
  ```powershell
  # OV cert as a PFX file:
  .\build.ps1 -Server https://voiptest.axustechnologies.com `
              -Pfx C:\secure\axus-codesign.pfx -PfxPassword '••••••'

  # EV cert installed on a token / in the Windows cert store (by thumbprint):
  .\build.ps1 -Server https://voiptest.axustechnologies.com `
              -CertThumbprint 1A2B3C4D5E6F...   # token PIN prompts at sign time
  ```
  `signtool.exe` comes with the Windows SDK; `build.ps1` auto-locates it.

- **The CODE binding is signature-safe.** A signed .exe must be served
  byte-for-byte or its signature breaks. The collector **auto-detects a signed
  probe** (`probecfg.IsSigned`) and then serves it unmodified, while the CODE
  rides in the **download filename** (`voiptesterprobe-<CODE>.exe`), which the
  probe reads on launch (`probecfg.CodeFromName`). Unsigned builds keep using the
  richer appended trailer (server URL + CODE, survives a rename). No collector
  flag to flip — it just works once the served binary is signed.

## Deploy after signing

1. Build signed probes (command above) → `bin\voiptesterprobe.exe` +
   `bin\voiptesterprobe-cli.exe`.
2. Copy both to the collector box at `/home/ubuntu/voiptest/` (replacing the
   unsigned ones). The systemd unit already points `-voiptesterprobe-exe` /
   `-voiptesterprobe-cli-exe` at them; restart the collector:
   `sudo systemctl restart voiptest.service`.
3. Verify: `curl -s .../healthz` and download once — the SmartScreen prompt
   should be gone (EV) or show the Axus publisher.

## Verifying a signature locally

```powershell
signtool verify /pa /v .\bin\voiptesterprobe.exe
```
