-- More source types, cross-source deduplication, and source suggestions.

-- New source types: Teamtailor (RSS), SmartRecruiters (API), Sweden Game Jobs (aggregator).
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in ('greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters', 'swedengamejobs'));
-- Optional country filter (used by SmartRecruiters, whose company boards are often global).
alter table sources add column country text;

-- Same posting from two sources shares a dedupe key (ATS job id, or a cleaned-up URL).
alter table jobs add column dedupe_key text;
create index jobs_dedupe_key_idx on jobs (dedupe_key);
-- No usable description was found; the score is based on title and location only.
alter table jobs add column thin boolean not null default false;

-- Companies seen on an aggregator that could be added as direct sources.
create table source_suggestions (
  id uuid primary key default gen_random_uuid(),
  ats text not null,          -- a sources.ats value, or 'custom' (no adapter)
  slug text not null,
  company_name text not null,
  job_count int not null default 0,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  last_seen_at timestamptz not null default now(),
  unique (ats, slug)
);

alter table source_suggestions enable row level security;
create policy owner_all on source_suggestions for all to authenticated
  using (is_allowed()) with check (is_allowed());
grant select, insert, update, delete on source_suggestions to authenticated;
grant all on source_suggestions to service_role;
