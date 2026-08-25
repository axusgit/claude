# First-time provisioning — Axus Syslog on axus-server01

Run these **once** to stand up the service on the shared box
(`98.88.111.130`, ssh alias `sra` / `axus-server01`). After this, day-to-day
updates are just `bash deploy/deploy.sh` from the repo root.

> You must be on a network the box's firewall allows (the office IP allowlist),
> or SSH to port 22 will time out.

## 0. DNS (optional but recommended)

Point `syslog.axustechnologies.com` → `98.88.111.130` (A record). The web UI
works by IP without it, but TLS (below) needs the name.

## 1. Push the code

From the repo root on your machine:

```bash
bash deploy/deploy.sh
```

The first run creates `/opt/axus-syslog` and installs deps. The `systemctl
restart` at the end will fail until the unit + `.env` exist (steps 2–3) — that's
expected on the very first push.

> **better-sqlite3 build note:** it normally installs a prebuilt binary. If
> `npm install` tries to compile and fails, install build tools once:
> `sudo apt-get update && sudo apt-get install -y build-essential python3`, then
> re-run the deploy.

## 2. Create the environment file on the box

```bash
ssh sra
cd /opt/axus-syslog
cp .env.example .env
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'))"   # paste into .env
nano .env    # set ADMIN_PASSWORD (strong), SESSION_SECRET, BASE_URL
```

## 3. Install the systemd unit

```bash
sudo cp /opt/axus-syslog/deploy/axus-syslog.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now axus-syslog
systemctl status axus-syslog --no-pager
# Confirm it's listening for syslog:
sudo ss -ulnp | grep :514
```

### 3a. Grant the scoped ufw sudo rule (for the dashboard Firewall panel)

The dashboard can manage the UDP-514 allow-list. That needs the service (running
as `ubuntu`) to run `ufw` as root — scoped to the ufw binary only:

```bash
sudo cp /opt/axus-syslog/deploy/sudoers-axus-syslog /etc/sudoers.d/axus-syslog
sudo chmod 440 /etc/sudoers.d/axus-syslog
sudo visudo -c -f /etc/sudoers.d/axus-syslog     # must say "parsed OK"
```

> The unit is deliberately configured so this works: `NoNewPrivileges` is **off**,
> there is **no** `CapabilityBoundingSet=` (which would strip CAP_SETUID/SETGID),
> and `ReadWritePaths=/etc/ufw` lets ufw write its rule files under
> `ProtectSystem=full`. If you harden further, keep those three or the Firewall
> panel breaks (it degrades gracefully to a clear error, ingest is unaffected).

### 3b. Disable IPv6 in ufw (this VM is IPv4-only)

IPv6 is disabled on the AWS VM, so keep ufw from creating/showing dead `(v6)`
rules:

```bash
sudo sed -i 's/^IPV6=yes/IPV6=no/' /etc/default/ufw
sudo ufw --force disable && sudo ufw --force enable   # re-applies IPv4 rules only
sudo ufw status                                        # should show no "(v6)" lines
```

## 4. Open UDP 514 to your log sources

Two layers:

- **Lightsail / EC2 firewall (security group):** add an inbound rule
  **UDP 514** from your device networks (e.g. the office/branch WAN IPs, or the
  Meraki source IPs). Don't leave 514 open to `0.0.0.0/0` — syslog is
  unauthenticated.
- **Host firewall (if ufw is active):** `sudo ufw allow from <SRC> to any port 514 proto udp`

## 5. Web dashboard behind nginx + TLS

```bash
sudo cp /opt/axus-syslog/deploy/nginx-syslog.conf /etc/nginx/sites-available/syslog
sudo ln -s /etc/nginx/sites-available/syslog /etc/nginx/sites-enabled/syslog
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d syslog.axustechnologies.com   # adds HTTPS + redirect
```

## 6. Verify end to end

Send a test message from any Linux host (or the box itself):

```bash
logger -n 98.88.111.130 -P 514 -d "hello from $(hostname) — axus-syslog test"
# or without logger:
echo '<34>1 2026-08-24T12:00:00Z testhost app 1234 ID1 - test message' \
  | nc -u -w1 98.88.111.130 514
```

Sign in at **https://syslog.axustechnologies.com** — the message should appear
(flip on **Live tail** to watch them arrive in real time).

## Pointing devices at it

Configure each device's syslog/remote-logging to
**`98.88.111.130` UDP port 514**. For Meraki: Network-wide → General → Reporting
→ Syslog servers → add the IP, port 514, pick the roles to log.
