# Axus Geo-Firewall — fleet kit

US/Canada geo-firewall for Axus servers, **centrally controlled from the Hub**
("Country access control" admin page). Edit the country allowlist once in the
Hub GUI and every connected box follows within ~5 minutes.

## How it works

- **Hub** holds the master policy (mode + countries) and serves it to boxes at a
  token-authed endpoint; each box reports status back (shown as "Server
  firewalls" under the Hub geo card).
- **Each box** runs an `ipset` allowlist of US/CA CIDRs (from ipdeny.com),
  enforced on port 443 (+ any extra ports) via **ufw** `before.rules`, or via the
  **Docker `DOCKER-USER`** chain on Docker hosts (e.g. the Hub). SSH (22) and
  ACME (80) always stay open; established connections are never dropped; Axus
  infra IPs are always allowed.
- A 5-minute `geo-firewall-sync` timer pulls the Hub policy; a weekly
  `geo-firewall-update` timer refreshes the country IP data.

## Onboard a NEW box (firewall + Hub connection in one step)

New Axus servers should get this as a standard provisioning step. From this
directory, copy the kit to the box and run the installer:

```bash
scp -r infra/geo-firewall <box>:/tmp/geo-firewall
ssh <box> "cd /tmp/geo-firewall && sudo ./install.sh \
    --name axus-<box> \
    --token <GEO_FLEET_TOKEN>"
```

- `--token` is the `GEO_FLEET_TOKEN` from the Hub's `infra/.env`.
- Enforcement is auto-detected (ufw vs Docker); override with `--enforcement`.
- Add extra gated ports with `--gated-tcp "443 8443"` / `--gated-udp "40000:40031"`
  (e.g. axus-server01 gates the VoIP media range).

The box then appears in the Hub's **Country access control → Server firewalls**
list and follows the central policy automatically.

## Exceptions

- **axus-wp01** (public WordPress site) is deliberately NOT geo-restricted.

## Files

| Path | Purpose |
| --- | --- |
| `install.sh` | One-command onboarding (firewall + Hub sync). |
| `scripts/geo-firewall-update.sh` | Rebuild the `geo_allow` ipset from `countries.conf` + `always-allow.conf`. |
| `scripts/geo-firewall-restore.sh` | Restore the ipset at boot (before ufw). |
| `scripts/geo-firewall-sync.sh` | Pull the Hub policy and apply; heartbeat back. |
| `scripts/geo-firewall-docker.sh` | Apply the block via `DOCKER-USER` (Docker hosts). |
| `config/countries.conf` | Bootstrap default allowlist (Hub overrides at runtime). |
| `config/always-allow.conf` | CIDRs always allowed (Axus boxes, office, telephony). |
| `systemd/*` | Boot-restore, weekly refresh, and 5-min Hub-sync units. |
