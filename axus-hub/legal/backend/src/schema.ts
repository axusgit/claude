// Schema applied idempotently at startup (Postgres 13+ for gen_random_uuid()).
// Field coordinates are normalized (0..1) relative to page width/height so the
// same layout renders correctly at any zoom / on the sealed PDF.
export const SCHEMA_SQL = `
create table if not exists envelope (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  status      text not null default 'draft',   -- draft|sent|completed|voided
  created_by  text not null,                    -- staff email
  source_file text,                             -- stored original (converted to pdf for signing)
  pdf_file    text,                             -- render/sign PDF
  source_pages int,
  sealed_file text,                             -- final flattened+sealed PDF
  sha256      text,                             -- hash of the sealed PDF
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  completed_at timestamptz
);

create table if not exists recipient (
  id          uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references envelope(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        text not null default 'signer',   -- signer|viewer|approver
  sign_order  int  not null default 1,
  status      text not null default 'pending',  -- pending|sent|viewed|signed|declined
  sign_token  text unique,
  consent_at  timestamptz,
  signed_at   timestamptz,
  ip          text,
  user_agent  text
);

create table if not exists field (
  id           uuid primary key default gen_random_uuid(),
  envelope_id  uuid not null references envelope(id) on delete cascade,
  recipient_id uuid references recipient(id) on delete cascade,
  type         text not null,                   -- signature|initials|date|text|checkbox
  page         int  not null,
  x real not null, y real not null, w real not null, h real not null,  -- normalized 0..1
  value        text,
  required     boolean not null default true
);

-- Append-only audit log (never updated/deleted) — the backbone of legal validity.
create table if not exists event (
  id          uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references envelope(id) on delete cascade,
  actor       text,
  type        text not null,                    -- created|sent|viewed|consented|signed|completed|voided
  detail      text,
  ip          text,
  at          timestamptz not null default now()
);

create index if not exists idx_recipient_envelope on recipient(envelope_id);
create index if not exists idx_field_envelope on field(envelope_id);
create index if not exists idx_event_envelope on event(envelope_id);
`;
