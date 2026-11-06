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
  wrapped_fk  text not null,                  -- base64 (folder key, AES-GCM under VK)
  sort        int not null default 0,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_folder_parent on folder(parent_id);

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
