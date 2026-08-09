# Axus File Share

A secure file-upload portal. **You** log in (admin), generate a secret upload
link for someone, and send it. They open the link and drop files — no account
needed. Files land in a folder on the server and you browse/download/delete them
from the admin page.

Live: **https://sp.axustechnologies.com** on `axus-server01` (SSH alias `sra`).

It works in **both directions**:
- **Receive** — someone uploads files **to** you (upload links → `/u/<token>`).
- **Send** — you upload files and share a link so someone can **download** them
  (download links → `/d/<token>`).

## Receiving files (upload links)
1. Go to https://sp.axustechnologies.com and sign in (see credentials handoff).
2. **Create an upload link** — give it a label (e.g. "Tax docs from Jane"),
   optionally an expiry and/or a max-file limit (set max = 1 for one-time use),
   and an optional note shown to the uploader.
3. **Copy** the link and send it to the person.
4. They upload; the files appear under **Received files** — download or delete.
5. **Disable** a link anytime to kill it immediately.

## Sending files (download links)
1. On the admin page, use **Send a file** — give it a label, optionally an
   expiry and/or a max-download limit (set max = 1 for one-time use), an optional
   note, then drag in one or more files.
2. Click **Create download link**; copy the `/d/<token>` link it gives you and
   send it to the recipient.
3. They open the link and click **Download** — no account or password needed.
4. Manage links under **Download links** — disable/enable or delete (deleting
   also removes the shared files from the server).

**Re-sharing a file someone sent you:** in **Received files**, each file has a
**Share** button that instantly creates a `/d/<token>` download link for it (the
file is copied, so the original stays put). Then copy the new link from the
**Download links** section.

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
(`data/db.json`, with `links` = inbound and `sends` = outbound); inbound files in
`data/uploads/<token>/`, outbound (shared) files in `data/sends/<token>/`. No
database. No file-size or file-count limit by default (`MAX_UPLOAD_MB=0`).

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
