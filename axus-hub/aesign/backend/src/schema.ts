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
-- Added after initial release; ADD COLUMN IF NOT EXISTS keeps it idempotent.
alter table envelope add column if not exists sequential boolean not null default false;
alter table envelope add column if not exists doc_type text;   -- SOW | MSA | Quote
alter table envelope add column if not exists company text;    -- associated company name
alter table envelope add column if not exists reminder_interval text;      -- daily | weekly | monthly
alter table envelope add column if not exists last_reminded_at timestamptz;
alter table envelope add column if not exists reminder_time text;          -- "HH:MM" (ET)
alter table envelope add column if not exists reminder_dow  int;           -- 0-6 (Sun=0), weekly
alter table envelope add column if not exists reminder_dom  int;           -- 1-31, monthly
alter table envelope add column if not exists quote_data jsonb;            -- generated-quote source data
alter table envelope add column if not exists field_layout jsonb;          -- auto-place signer-field layout (Quote)
alter table envelope add column if not exists doc_number text;             -- reference # for a Certificate of Completion
alter table recipient add column if not exists decline_reason text;        -- why a signer declined (>= 10 words)
alter table recipient add column if not exists declined_at timestamptz;
alter table envelope add column if not exists archived boolean not null default false;  -- moved to the Archive tab
alter table envelope add column if not exists archived_at timestamptz;

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

-- Reusable contact list (shared across Axus staff), so recipients can be picked
-- instead of retyped.
create table if not exists contact (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  company    text,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_contact_email on contact (lower(email));

-- Companies (imported from QuickBooks) that documents are associated with.
create table if not exists company (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_company_name on company (lower(name));
alter table company add column if not exists address text;
alter table company add column if not exists phone text;

-- System-wide activity log (who did what, when) — a simple movement trail.
create table if not exists activity (
  id     uuid primary key default gen_random_uuid(),
  at     timestamptz not null default now(),
  actor  text,
  action text not null,
  detail text
);
alter table activity add column if not exists envelope_id uuid;
create index if not exists idx_activity_at on activity(at desc);
`;
