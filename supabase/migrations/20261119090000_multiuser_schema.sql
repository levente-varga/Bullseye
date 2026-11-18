-- Multi-user, step 1 of 3: new tables and columns, additive only.
--
-- Postings stay shared (jobs, sources); everything personal moves to per-user rows:
-- matches (a person's status/score for a posting), subscriptions (the sources a person
-- follows), and user_id on criteria, profile, feedback, answers and suggestions.
-- The current app keeps using the old columns until step 2 switches it over, so
-- nothing here changes behaviour. backfill_multiuser() copies the single-user data
-- into the new shape; it is idempotent and runs again when step 2 is applied.

-- ---------------------------------------------------------------------------
-- Members: who may use the app, who's the admin, and their AI spend caps
-- (here, not in criteria, so only the admin can change them).
-- ---------------------------------------------------------------------------
create table members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  is_admin boolean not null default false,
  max_run_cost_usd numeric(8, 2) not null default 0.25 check (max_run_cost_usd >= 0),
  max_daily_cost_usd numeric(8, 2) not null default 1.00 check (max_daily_cost_usd >= 0),
  created_at timestamptz not null default now()
);

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid());
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and is_admin);
$$;

revoke execute on function is_member(), is_admin() from anon, public;
grant execute on function is_member(), is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings: the shared schedule and scoring model (admin-only), plus a global
-- 24-hour spend cap across everyone.
-- ---------------------------------------------------------------------------
create table settings (
  id int primary key default 1 check (id = 1),
  daily_time text not null default '05:30' check (daily_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  daily_enabled boolean not null default true,
  watch_interval_minutes int not null default 60
    check (watch_interval_minutes in (0, 15, 30, 60, 120, 240, 360, 720)),
  timezone text not null default 'UTC',
  scoring_model text not null default 'claude-haiku-5-5'
    check (scoring_model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5')),
  max_total_daily_cost_usd numeric(8, 2) not null default 3.00 check (max_total_daily_cost_usd >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Per-person settings rows: criteria and profile get a user_id (the old id = 1
-- singleton key is dropped in step 3).
-- ---------------------------------------------------------------------------
alter table criteria add column user_id uuid unique references auth.users (id) on delete cascade;
alter table profile add column user_id uuid unique references auth.users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Matches: one person's view of one posting.
-- ---------------------------------------------------------------------------
create table matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  status job_status not null default 'new',
  status_changed_at timestamptz not null default now(),
  filter_reason text,
  score int check (score between 0 and 100),
  score_summary text,
  score_pros text[],
  score_cons text[],
  scored_at timestamptz,
  notified_at timestamptz,
  applied_at timestamptz,
  followed_up_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create index matches_user_status_score_idx on matches (user_id, status, score desc);
create index matches_job_idx on matches (job_id);

-- Same rule as jobs_touch_status: status changes stamp the time (and applied_at).
create trigger matches_touch_status before update on matches
  for each row execute function touch_status();

-- When a source drops a posting, it's closed for everyone (matches follow).
alter table jobs add column closed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Subscriptions: the sources a person follows. Sources become a shared catalog
-- of boards; a board is fetched once however many people follow it.
-- ---------------------------------------------------------------------------
create table subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references sources (id) on delete cascade,
  company_name text not null,
  watchlist boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, source_id)
);
create index subscriptions_source_idx on subscriptions (source_id);

-- ---------------------------------------------------------------------------
-- Per-person rows elsewhere.
-- ---------------------------------------------------------------------------
alter table feedback add column user_id uuid references auth.users (id) on delete cascade;
alter table answers add column user_id uuid references auth.users (id) on delete cascade;
alter table source_suggestions add column user_id uuid references auth.users (id) on delete cascade;

-- Runs stay one global log; each person's share of a run (what was filtered and
-- scored for them, and what it cost) is a row here. Spend caps sum these.
create table run_users (
  run_id uuid not null references runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stats jsonb not null default '{}',
  primary key (run_id, user_id)
);
create index run_users_user_idx on run_users (user_id);

-- ---------------------------------------------------------------------------
-- Row level security for the new tables. (Existing tables keep their policies
-- until step 2.)
-- ---------------------------------------------------------------------------
alter table members enable row level security;
create policy members_read on members for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy members_admin on members for all to authenticated
  using (is_admin()) with check (is_admin());

alter table settings enable row level security;
create policy settings_read on settings for select to authenticated using (is_member());
create policy settings_admin on settings for update to authenticated using (is_admin()) with check (is_admin());

alter table matches enable row level security;
create policy matches_own on matches for all to authenticated
  using (user_id = auth.uid() and is_member()) with check (user_id = auth.uid() and is_member());

alter table subscriptions enable row level security;
create policy subscriptions_own on subscriptions for all to authenticated
  using (user_id = auth.uid() and is_member()) with check (user_id = auth.uid() and is_member());

alter table run_users enable row level security;
create policy run_users_read on run_users for select to authenticated
  using ((user_id = auth.uid() and is_member()) or is_admin());

grant select, insert, update, delete on members, matches, subscriptions to authenticated;
grant select, update on settings to authenticated;
grant select on run_users to authenticated;
grant all on members, settings, matches, subscriptions, run_users to service_role;

-- ---------------------------------------------------------------------------
-- Backfill: the single user's data into the new shape. Idempotent; re-run when
-- step 2 is applied to pick up anything the old app wrote in between.
-- ---------------------------------------------------------------------------
create or replace function backfill_multiuser() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  result jsonb;
begin
  select u.id into owner
  from auth.users u join allowed_users a on lower(a.email) = lower(u.email)
  order by u.created_at limit 1;
  if owner is null then
    raise exception 'backfill_multiuser: no auth user matches allowed_users';
  end if;

  insert into members (user_id, email, is_admin)
  select u.id, u.email, u.id = owner
  from auth.users u join allowed_users a on lower(a.email) = lower(u.email)
  on conflict (user_id) do nothing;

  insert into settings (id, daily_time, daily_enabled, watch_interval_minutes, timezone, scoring_model)
  select 1, daily_time, daily_enabled, watch_interval_minutes, timezone, scoring_model from criteria where id = 1
  on conflict (id) do update set
    daily_time = excluded.daily_time, daily_enabled = excluded.daily_enabled,
    watch_interval_minutes = excluded.watch_interval_minutes, timezone = excluded.timezone,
    scoring_model = excluded.scoring_model;

  -- The owner's caps were on criteria.
  update members m set max_run_cost_usd = c.max_run_cost_usd, max_daily_cost_usd = c.max_daily_cost_usd
  from criteria c where c.id = 1 and m.user_id = owner;

  update criteria set user_id = owner where id = 1 and user_id is null;
  update profile set user_id = owner where id = 1 and user_id is null;

  insert into matches (user_id, job_id, status, status_changed_at, filter_reason, score, score_summary,
                       score_pros, score_cons, scored_at, notified_at, applied_at, followed_up_at, created_at)
  select owner, j.id, j.status, j.status_changed_at, j.filter_reason, j.score, j.score_summary,
         j.score_pros, j.score_cons, j.scored_at, j.notified_at, j.applied_at, j.followed_up_at, j.first_seen_at
  from jobs j
  on conflict (user_id, job_id) do update set
    status = excluded.status, status_changed_at = excluded.status_changed_at,
    filter_reason = excluded.filter_reason, score = excluded.score, score_summary = excluded.score_summary,
    score_pros = excluded.score_pros, score_cons = excluded.score_cons, scored_at = excluded.scored_at,
    notified_at = excluded.notified_at, applied_at = excluded.applied_at, followed_up_at = excluded.followed_up_at;

  update jobs set closed_at = status_changed_at where status = 'closed' and closed_at is null;

  insert into subscriptions (user_id, source_id, company_name, watchlist, enabled, created_at)
  select owner, s.id, s.company_name, s.watchlist, s.enabled, s.created_at from sources s
  on conflict (user_id, source_id) do update set
    company_name = excluded.company_name, watchlist = excluded.watchlist, enabled = excluded.enabled;

  update feedback set user_id = owner where user_id is null;
  update answers set user_id = owner where user_id is null;
  update source_suggestions set user_id = owner where user_id is null;

  insert into run_users (run_id, user_id, stats)
  select r.id, owner, r.stats from runs r
  on conflict (run_id, user_id) do update set stats = excluded.stats;

  select jsonb_build_object(
    'owner', owner,
    'members', (select count(*) from members),
    'jobs', (select count(*) from jobs),
    'matches', (select count(*) from matches where user_id = owner),
    'sources', (select count(*) from sources),
    'subscriptions', (select count(*) from subscriptions where user_id = owner),
    'runs', (select count(*) from runs),
    'run_users', (select count(*) from run_users where user_id = owner)
  ) into result;
  return result;
end;
$$;

revoke execute on function backfill_multiuser() from public, anon, authenticated;
grant execute on function backfill_multiuser() to service_role;

select backfill_multiuser();
