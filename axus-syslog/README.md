# Axus Syslog

A self-hosted **syslog server**: it receives syslog messages over the network
(UDP 514, RFC 3164 & RFC 5424), stores them in a local SQLite database, and
gives you a password-protected **web dashboard** to search, filter, and live-tail
the logs.

Target: **syslog.axustechnologies.com** on `axus-server01` (`98.88.111.130`,
ssh alias `sra`) — another tenant alongside SRA, File Share, and ProAITrader.

## What it does

- **Collects** syslog over **UDP 514** from any device that can forward logs —
  Meraki gear, firewalls, switches, servers, containers.
- **Parses** both the old BSD format (RFC 3164) and the modern one (RFC 5424):
  priority → facility + severity, hostname, app/tag, PID, timestamp, message.
  Anything unparseable is still stored raw, so nothing is dropped.
- **Stores** to SQLite with buffered batch writes, so UDP bursts don't thrash
  the disk. Indexed on time, host, severity, and source for fast queries.
- **Dashboard** (Axus clean look): live stat tiles, full-text search, filter by
  host / minimum severity / time range, colour-coded severity, paging, a
  top-sources chart, and a **Live tail** toggle (Server-Sent Events) that streams
  new messages into the table as they arrive.
- **Download / export**: stream the messages matching the current filters as
  **CSV**, **JSON** (NDJSON), or plain **text** — no row cap, streamed so large
  exports don't blow memory.
- **Firewall panel**: manage the on-box `ufw` allow-list for the ingest port
  (add/remove source IPs/CIDRs) from the dashboard. Applied via a tightly-scoped
  passwordless sudo (`ufw` binary only); strict IP/CIDR validation + `execFile`
  (no shell) so input can't reach a shell. The cloud firewall (Lightsail/AWS SG)
  is still managed separately.
- **Retention**: auto-prunes messages older than `RETENTION_DAYS` and/or past a
  `MAX_ROWS` cap, hourly.

## Stack

Node + Express, `better-sqlite3`, `cookie-session`. UDP listener via the
built-in `dgram`. No build step, no external services, no cloud DB. The web UI is
server-rendered HTML + a small vanilla-JS client hitting a JSON API.

```
server.js            Express app, auth, JSON API, SSE stream, wiring
lib/collector.js     UDP 514 listener → parse → buffer → emit
lib/parser.js        RFC 3164 / 5424 parsing, PRI decode, facility/severity names
lib/db.js            SQLite store: batched inserts, query, stats, retention
lib/views.js         HTML shell (login + dashboard) + client JS
deploy/              systemd unit, nginx vhost, deploy.sh, SETUP.md
data/                SQLite DB (created at runtime; gitignored)
```

## Configuration

Copy `.env.example` to `.env` and set at least `ADMIN_PASSWORD` and
`SESSION_SECRET`. See that file for every option (ports, bind address,
retention, branding).

## Run locally (Windows / any dev box)

Binding UDP **514** needs privileges, so for local testing use a high port:

```bash
npm install
# PowerShell:
$env:ADMIN_PASSWORD="test"; $env:SESSION_SECRET="dev"; $env:SYSLOG_UDP_PORT="5140"; $env:PORT="3260"; npm start
```

Open http://localhost:3260 (user `admin`, password `test`). Send a test message
to the high port:

```bash
echo '<34>1 2026-08-24T12:00:00Z host1 app 42 ID1 - hello axus-syslog' | nc -u -w1 127.0.0.1 5140
```

On the server the service runs with `CAP_NET_BIND_SERVICE`, so it binds the real
**514** as the `ubuntu` user.

## Deploy / redeploy

First time: follow **`deploy/SETUP.md`** (systemd unit, `.env`, nginx + TLS,
open UDP 514 in the Lightsail firewall). After that, from the repo root:

```bash
bash deploy/deploy.sh          # syncs code (not .env/data), npm install, restart
```

`.env` and the `data/` database live on the box and are never committed or
overwritten by a deploy.

## Security notes

- The dashboard is behind a login (session cookie, HTTPS only in production).
- **Syslog ingest (UDP 514) is unauthenticated by protocol.** Restrict it in the
  Lightsail firewall to your known source IPs — never expose 514 to the whole
  internet.
- Change the admin password by editing `.env` and
  `sudo systemctl restart axus-syslog`.
