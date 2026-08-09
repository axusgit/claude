# Axus File Share

A secure file-upload portal. **You** log in (admin), generate a secret upload
link for someone, and send it. They open the link and drop files — no account
needed. Files land in a folder on the server and you browse/download/delete them
from the admin page.

Live: **https://sp.axustechnologies.com** on `axus-server01` (SSH alias `sra`).

## How you use it
1. Go to https://sp.axustechnologies.com and sign in (see credentials handoff).
2. **Create an upload link** — give it a label (e.g. "Tax docs from Jane"),
   optionally an expiry and/or a max-file limit (set max = 1 for one-time use),
   and an optional note shown to the uploader.
3. **Copy** the link and send it to the person.
4. They upload; the files appear under **Received files** — download or delete.
5. **Disable** a link anytime to kill it immediately.

## Security
- Admin area is password-protected (session cookie, HTTPS only).
- Upload links are unguessable tokens; expire by time and/or file count; revocable.
- Uploaders never see the admin side and never need a password.
- Filenames sanitized; path traversal blocked. No file-size or file-count limit
  by default (unlimited uploads); set `MAX_UPLOAD_MB` to reinstate a per-file cap.
- Change the admin password anytime by editing `.env` on the box and
  `sudo systemctl restart axus-fileshare`.

## Stack
Node + Express, `cookie-session`, `multer`. Metadata in a JSON file
(`data/db.json`); uploaded files in `data/uploads/<token>/`. No database.

## Deploy / redeploy
From the repo root:
```bash
bash deploy/deploy.sh          # syncs code (not .env/data), npm install, restart
```
Config lives in `.env` on the box (`/opt/axus-fileshare/.env`) — never committed.
See `.env.example` for all options.

### Server layout (already set up)
- App dir: `/opt/axus-fileshare` (data in `./data`)
- Service: `/etc/systemd/system/axus-fileshare.service` (`sudo systemctl {status,restart} axus-fileshare`)
- nginx: `/etc/nginx/sites-enabled/axus-fileshare` → `127.0.0.1:3210`, TLS via certbot
- DNS: `sp.axustechnologies.com` → 98.88.111.130

### Ops
```bash
ssh sra 'journalctl -u axus-fileshare -n 50 --no-pager'   # logs
ssh sra 'ls -la /opt/axus-fileshare/data/uploads'         # raw files (also grab via SFTP)
```
