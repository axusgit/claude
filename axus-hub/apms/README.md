# Axus Password Management System (APMS)

A **zero-knowledge** team password vault for Axus technical systems (not financial).
`apms.axustechnologies.com` — single Docker image (Node/Fastify backend serving a
React/Vite SPA), its own Postgres database (`apms`), gated by Authentik SSO.

Replaces the shared KeePass file: migrate technical-system passwords in, use it
from anywhere through the Hub.

## Zero-knowledge model (what the server can and can't see)

All cryptography happens **in the browser**. The server stores only ciphertext and
never has the passphrase, the vault key, or any plaintext. A compromise of the box
does **not** leak the vault (short of also phishing the passphrase).

Two-tier keys, so the passphrase can change without re-encrypting data:

```
passphrase ──Argon2id(m=19MiB,t=2)──▶ PK (passphrase key)
VK  = random 256-bit vault key  (root of trust)
wrapped_vk          = AES-256-GCM(PK, VK)            ← unlock path
recovery_wrapped_vk = RSA-OAEP(recoveryPub, VK)      ← break-glass path
folder:  FK = random 256-bit key ;  wrapped_fk = AES-GCM(VK, FK)
item:    data_enc = AES-GCM(FK, JSON{title,username,password,url,notes,totp,custom})
```

- **Unlock**: browser derives PK from the passphrase + stored salt, AES-unwraps VK,
  confirms against a canary. VK lives only in memory for the session and is wiped on
  **Lock** and after **15 min** of inactivity.
- **Recovery**: at setup an RSA recovery keypair is generated; the private key is
  shown **once** to the admin to store offline. If the shared passphrase is lost, the
  admin pastes the recovery key to re-derive VK and set a new passphrase. The server
  only ever holds the recovery *public* key + the wrapped VK.
- **Change passphrase**: re-wraps the same VK — no data is re-encrypted; the recovery
  key is unchanged.

## Roles & access

Identity comes from the Authentik forward-auth proxy headers (same contract as
`libs/auth`). Access is gated **upstream** by the Authentik policy binding — strict
like AATS, with **no "authentik Admins" fallback** — so only the explicit groups get
in. Add the technical staff who need it (including `acarr`) to the groups below.

| Role | Group(s) | Can |
|------|----------|-----|
| **User** | `app-apms` or `apms-role-user` | Read/write items in folders they're granted. |
| **Vault admin** | `apms-role-admin` | All **non-confidential** folders; manage folders, per-folder access, KeePass import, change passphrase, run recovery, view the access log. |

**Per-folder access** (server-enforced): a folder can be granted to Authentik groups
or individual emails, and the grant is inherited by the whole subtree. An ordinary
folder with no grants is admin-only. Because the vault uses a single shared passphrase,
the boundary for ordinary folders is enforced by the server (not cryptographically).

## Confidential folders (a second, cryptographic wall)

For owner / C-level secrets, a folder can be created **confidential** (restricted +
sealed). Two independent guards apply:

1. **Invisible to everyone but its named owners** — a confidential folder is *exempt*
   from the admins-see-everything rule. It is returned only to principals with an
   explicit grant on it, so another vault admin never sees the folder, its name, or
   its key material. (`folder.restricted`, enforced in `access.ts`.)
2. **Sealed under a second passphrase** — its contents are **not** wrapped under the
   shared vault key. They use a separate **Confidential Key (CK)** derived from a
   second passphrase known only to the owners:

   ```
   confidential passphrase ─Argon2id─▶ CPK
   CK = random 256-bit key  (root of trust for this folder)
   wrapped_ck          = AES-256-GCM(CPK, CK)          ← unlock path
   recovery_wrapped_ck = RSA-OAEP(folderRecoveryPub, CK) ← break-glass, own key
   folder:  wrapped_fk = AES-GCM(CK, FK)   (items decrypt via CK, never VK)
   ```

   So even someone holding VK (every unlocked user) — or a raw database/backup dump —
   cannot read a confidential folder without its passphrase. The folder *name* is
   wrapped under VK so owners can see it listed and choose to unlock; the *contents*
   are sealed under CK. Each confidential folder has its **own** offline recovery key,
   shown once at creation, separate from the vault recovery key.

Owners manage it from the **Vault** tab: `🛡 New confidential folder` (set name,
owners, and the confidential passphrase), then click the folder to **unlock** it for
the session (auto-locks with the vault), **lock** it on demand, change its passphrase,
or recover it with its recovery key. CK lives only in memory, per session, like VK.

## Import from KeePass (CSV)

Admin → **Import**. Export KeePass as **File → Export → CSV** (columns: Group, Title,
Username, Password, URL, Notes). The CSV is parsed **and encrypted in the browser**:
the KeePass `Group` becomes a folder path, plaintext never reaches the server. **Shred
the CSV afterward.** (CSV does not carry TOTP seeds or attachments.)

## API

All bodies are ciphertext or non-secret metadata.

- `GET  /api/me` — identity, role, `vaultInitialized`.
- `GET  /api/vault` · `POST /api/vault/init` · `POST /api/vault/rekey` · `GET /api/vault/recovery` — key material (never plaintext).
- `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`, `GET/PUT /api/folders/:id/access` — folder tree + access (admin for ordinary folders; **owners only** for confidential ones).
- `POST /api/folders/sealed` — create a confidential folder (row + seal material + owner grants, atomic).
- `GET /api/folders/:id/seal` · `POST /api/folders/:id/seal/rekey` · `GET /api/folders/:id/seal/recovery` — confidential-folder key material / passphrase change / break-glass (**owners only**).
- `GET/POST /api/items`, `PATCH/DELETE /api/items/:id`, `POST /api/items/import` — encrypted items.
- `POST /api/audit` (client events: unlock/reveal/copy) · `GET /api/audit` (admin: access log).
- `GET  /api/health`.

## Deploy

Same pattern as ATRS/eSign — single image built from the repo root, served behind
Traefik with `geogate@file,authentik@file`.

1. **DNS**: add A record `apms.axustechnologies.com → 52.22.69.65` (Hover).
2. **DB** (first deploy): `docker compose exec postgres psql -U axus -c 'CREATE DATABASE apms;'`
3. **Authentik**: the `axus-groups` + `axus-apps` blueprints add the groups, provider,
   application, outpost binding and access policies — restart `authentik-server` to apply.
   Add staff to `app-apms` / `apms-role-admin` in the Authentik admin (include `acarr`).
4. **Build/run**: from `/home/ubuntu/axus-platform/infra` →
   `docker compose build apms && docker compose up -d apms`.
   Schema is applied idempotently at startup (no migration step).
5. First admin opens the site and **creates the vault** (sets the shared passphrase,
   saves the recovery key offline), then imports the KeePass CSV.

The cert issues from Let's Encrypt once DNS resolves to the box (as with ATRS; a
`docker restart axus-apms-1` after propagation forces a reissue if needed).
