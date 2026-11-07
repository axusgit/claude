// Idempotent schema, applied at startup (no migration framework — CREATE IF NOT
// EXISTS + ALTER ADD COLUMN IF NOT EXISTS). Everything secret is stored as opaque
// base64 ciphertext produced in the browser; the server never decrypts it.
export const SCHEMA_SQL = `
create extension if not exists pgcrypto;

-- Singleton row (id = true) holding the vault's key material. The real vault key
-- (VK) is random and never leaves the browser in the clear; here we keep only:
--   wrapped_vk          = VK encrypted with the passphrase-derived key (PK)
--   recovery_wrapped_vk = VK encrypted to the admin recovery public key (RSA-OAEP)
-- plus the KDF salt/params needed to re-derive PK from the passphrase.
create table if not exists vault (
  id              boolean primary key default true check (id),
  kdf             text not null,              -- json: {alg, m, t, p}
  kdf_salt        text not null,              -- base64
  wrapped_vk      text not null,              -- base64 (AES-GCM, iv-prefixed)
  verifier        text not null,              -- base64 (AES-GCM of a known canary, under VK)
  recovery_pubkey text not null,              -- base64 SPKI (RSA-OAEP-256 public key)
  recovery_wrapped_vk text not null,          -- base64 (RSA-OAEP of VK)
  created_by      text not null,
  created_at      timestamptz not null default now(),
  rekeyed_at      timestamptz
);

create table if not exists folder (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references folder(id) on delete cascade,
  name_enc    text not null,                  -- base64 (AES-GCM under VK)
  wrapped_fk  text not null,                  -- base64 (folder key, AES-GCM under VK — or under the zone CK for a sealed folder)
  sort        int not null default 0,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_folder_parent on folder(parent_id);

-- A RESTRICTED folder (and its whole subtree) is a confidential zone. It is
-- EXEMPT from the admins-see-everything rule: it is visible only to principals
-- with an explicit folder_access grant on it — even platform/vault admins who
-- are not granted never see it, its name, or its key material. See access.ts.
alter table folder add column if not exists restricted boolean not null default false;

-- Per-restricted-folder key material ("seal"). A sealed folder's items are NOT
-- wrapped under the shared vault key (VK); they are wrapped under a separate
-- Confidential Key (CK) that is derived from a SECOND passphrase known only to
-- the folder's owners. So even someone holding VK (every unlocked user) or a raw
-- database/backup dump cannot decrypt a sealed folder without the confidential
-- passphrase. Mirrors the vault table, scoped to one folder.
--   wrapped_ck          = CK encrypted with the confidential-passphrase key (CPK)
--   verifier            = AES-GCM(CK, canary) — confirms the confidential passphrase
--   recovery_wrapped_ck = CK encrypted to this folder's own recovery public key
create table if not exists folder_seal (
  folder_id           uuid primary key references folder(id) on delete cascade,
  kdf                 text not null,          -- json: {alg, m, t, p}
  kdf_salt            text not null,          -- base64
  wrapped_ck          text not null,          -- base64 (AES-GCM, iv-prefixed)
  verifier            text not null,          -- base64 (AES-GCM of a known canary, under CK)
  recovery_pubkey     text not null,          -- base64 SPKI (RSA-OAEP-256 public key)
  recovery_wrapped_ck text not null,          -- base64 (RSA-OAEP of CK)
  created_by          text not null,
  created_at          timestamptz not null default now(),
  rekeyed_at          timestamptz
);

-- Who may access a folder (and its whole subtree). principal is 'group:<name>'
-- or 'user:<email>'. Admins (apms-role-admin) bypass this entirely.
create table if not exists folder_access (
  folder_id  uuid not null references folder(id) on delete cascade,
  principal  text not null,
  can_write  boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (folder_id, principal)
);
create index if not exists idx_folder_access_principal on folder_access(principal);

create table if not exists item (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references folder(id) on delete cascade,
  data_enc   text not null,                   -- base64 (AES-GCM under the folder key)
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_item_folder on item(folder_id);

-- Tamper-evident-ish access log. No secret values are ever logged — only who did
-- what to which id and when.
create table if not exists audit (
  id        bigserial primary key,
  ts        timestamptz not null default now(),
  actor     text not null,
  action    text not null,
  target    text,
  detail    text
);
create index if not exists idx_audit_ts on audit(ts desc);
`;
