// Schema applied idempotently at startup (Postgres 13+ for gen_random_uuid()).
// ATRS = Axus Time Reporting System. A worker (1099 contractor or staff) logs
// time entries (date + start/end → hours + task); each entry moves
// draft → submitted → approved | rejected. Approvals are done by an admin.
export const SCHEMA_SQL = `
-- People who log time. Auto-registered on first login from the SSO identity;
-- an admin can deactivate someone without deleting their history.
create table if not exists worker (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,            -- lower-cased SSO email
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists time_entry (
  id            uuid primary key default gen_random_uuid(),
  worker_email  text not null,                -- lower-cased; the person the time is for
  work_date     date not null,                -- the day worked
  start_time    time not null,                -- wall-clock start, as entered
  end_time      time not null,                -- wall-clock end, as entered
  hours         numeric(6,2) not null,        -- computed from start/end (overnight = +24h)
  task          text not null,                -- what was done
  status        text not null default 'draft',-- draft | submitted | approved | rejected
  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    text,                         -- admin email who approved/rejected
  decision_note text,                         -- optional note (esp. on rejection)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_time_entry_worker on time_entry (worker_email);
create index if not exists idx_time_entry_status on time_entry (status);
create index if not exists idx_time_entry_date on time_entry (work_date);
`;
