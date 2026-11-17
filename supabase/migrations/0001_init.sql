-- Headshot schema. Single-user app: every table is locked to the emails listed
-- in allowed_users. The worker uses the service-role key, which bypasses RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
create table allowed_users (
  email text primary key
);

create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_users where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ---------------------------------------------------------------------------
-- Singletons: profile + criteria (id is always 1)
-- ---------------------------------------------------------------------------
create table profile (
  id int primary key default 1 check (id = 1),
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  location text not null default '',
  links text[] not null default '{}',
  headline text not null default '',
  cv_text text not null default '',
  updated_at timestamptz not null default now()
);

create table criteria (
  id int primary key default 1 check (id = 1),
  roles text[] not null default '{}',            -- title must contain one of these (case-insensitive); empty = any
  locations text[] not null default '{}',        -- location must contain one of these; empty = any
  remote_ok boolean not null default true,       -- remote jobs pass the location filter
  include_keywords text[] not null default '{}', -- description must contain at least one; empty = any
  exclude_keywords text[] not null default '{}', -- title containing any of these whole words is filtered out
  preferences text not null default '',          -- free text for the LLM scorer
  score_threshold int not null default 60 check (score_threshold between 0 and 100),
  followup_days int not null default 10 check (followup_days > 0),
  updated_at timestamptz not null default now()
);

insert into profile (id) values (1);
insert into criteria (id) values (1);

-- ---------------------------------------------------------------------------
-- Sources: company job boards on public ATS APIs
-- ---------------------------------------------------------------------------
create table sources (
  id uuid primary key default gen_random_uuid(),
  ats text not null check (ats in ('greenhouse', 'lever', 'ashby')),
  slug text not null,
  company_name text not null,
  watchlist boolean not null default false,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (ats, slug)
);

-- ---------------------------------------------------------------------------
-- Jobs + pipeline
-- ---------------------------------------------------------------------------
create type job_status as enum (
  'new',          -- fetched, not yet processed
  'filtered',     -- removed by hard filters
  'scored',       -- scored by the LLM, waiting for you
  'skipped',      -- you skipped it
  'approved',     -- you want to apply
  'applied',
  'interview',
  'offer',
  'rejected',
  'closed'        -- posting disappeared before you acted
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  external_id text not null,
  title text not null,
  company text not null,
  location text not null default '',
  remote boolean not null default false,
  url text not null,
  description text not null default '',
  compensation text,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  status job_status not null default 'new',
  status_changed_at timestamptz not null default now(),
  filter_reason text,
  score int check (score between 0 and 100),
  score_summary text,
  score_pros text[],
  score_cons text[],
  scored_at timestamptz,
  notified_at timestamptz,      -- included in a digest/alert
  applied_at timestamptz,
  followed_up_at timestamptz,
  unique (source_id, external_id)
);

create index jobs_status_score_idx on jobs (status, score desc);
create index jobs_notified_idx on jobs (notified_at) where notified_at is null;

create or replace function touch_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'applied' and new.applied_at is null then
      new.applied_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger jobs_touch_status before update on jobs
  for each row execute function touch_status();

-- ---------------------------------------------------------------------------
-- Feedback: every approve/skip decision, used to tune scoring
-- ---------------------------------------------------------------------------
create table feedback (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  decision text not null check (decision in ('approve', 'skip')),
  reasons text[] not null default '{}',
  note text,
  created_at timestamptz not null default now()
);

create index feedback_created_idx on feedback (created_at desc);

-- ---------------------------------------------------------------------------
-- Answer bank: reusable answers to common application questions
-- ---------------------------------------------------------------------------
create table answers (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Runs: the report log of every worker execution
-- ---------------------------------------------------------------------------
create table runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('watchlist', 'full', 'digest')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}',
  error text
);

create index runs_started_idx on runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Row level security: only allowed users, full access
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profile','criteria','sources','jobs','feedback','answers','runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy owner_all on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t);
  end loop;
end $$;

alter table allowed_users enable row level security;
-- no policies on allowed_users: only the service role / SQL editor can read or change it

-- ---------------------------------------------------------------------------
-- Data API grants. Written for "Automatically expose new tables" = off, and
-- also correct if it is on: the anonymous role gets nothing, the signed-in
-- user gets table access (still filtered by RLS above), the worker's
-- service role gets everything.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on function is_allowed() from anon, public;

grant select, insert, update, delete
  on profile, criteria, sources, jobs, feedback, answers, runs
  to authenticated;
grant execute on function is_allowed() to authenticated;

grant all on all tables in schema public to service_role;
grant execute on function is_allowed() to service_role;
