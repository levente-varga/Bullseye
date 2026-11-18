-- Multi-user, step 2 of 3: per-person access rules, views and helpers.
--
-- Compatible with the single-user app still in production, so this can be applied
-- before the release that switches the app over: criteria/profile keep their id
-- column, the admin keeps write access to jobs and sources ("legacy" policies), and
-- the old unique key on suggestions stays. Step 3 removes those leftovers.

-- The backfill, made safe to re-run at any time: a match only takes the old jobs
-- columns when they're newer (the single-user app changed it), subscriptions and
-- run shares that exist are left alone. Then pick up what the old app wrote since step 1.
create or replace function backfill_multiuser() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  select user_id into owner from members where is_admin order by created_at limit 1;
  if owner is null then raise exception 'backfill_multiuser: no admin member'; end if;

  insert into matches (user_id, job_id, status, status_changed_at, filter_reason, score, score_summary,
                       score_pros, score_cons, scored_at, notified_at, applied_at, followed_up_at, created_at)
  select owner, j.id, j.status, j.status_changed_at, j.filter_reason, j.score, j.score_summary,
         j.score_pros, j.score_cons, j.scored_at, j.notified_at, j.applied_at, j.followed_up_at, j.first_seen_at
  from jobs j
  on conflict (user_id, job_id) do update set
    status = excluded.status, status_changed_at = excluded.status_changed_at,
    filter_reason = excluded.filter_reason, score = excluded.score, score_summary = excluded.score_summary,
    score_pros = excluded.score_pros, score_cons = excluded.score_cons, scored_at = excluded.scored_at,
    notified_at = excluded.notified_at, applied_at = excluded.applied_at, followed_up_at = excluded.followed_up_at
  where excluded.status_changed_at > matches.status_changed_at
     or excluded.scored_at > coalesce(matches.scored_at, '-infinity'::timestamptz);

  update jobs set closed_at = status_changed_at where status = 'closed' and closed_at is null;

  insert into subscriptions (user_id, source_id, company_name, watchlist, enabled, created_at)
  select owner, s.id, s.company_name, s.watchlist, s.enabled, s.created_at from sources s
  where not exists (select 1 from subscriptions x where x.source_id = s.id)
  on conflict (user_id, source_id) do nothing;

  update feedback set user_id = owner where user_id is null;
  update answers set user_id = owner where user_id is null;
  update source_suggestions set user_id = owner where user_id is null;

  insert into run_users (run_id, user_id, stats)
  select r.id, owner, r.stats from runs r
  where not exists (select 1 from run_users x where x.run_id = r.id)
  on conflict (run_id, user_id) do nothing;

  return jsonb_build_object(
    'matches', (select count(*) from matches where user_id = owner),
    'jobs', (select count(*) from jobs),
    'subscriptions', (select count(*) from subscriptions where user_id = owner),
    'sources', (select count(*) from sources)
  );
end;
$$;

select backfill_multiuser();

-- ---------------------------------------------------------------------------
-- criteria / profile: one row per person, keyed by user_id.
-- ---------------------------------------------------------------------------
alter table criteria drop constraint criteria_pkey;
alter table criteria drop constraint criteria_id_check;
alter table criteria alter column id drop not null, alter column id drop default;
alter table criteria alter column user_id set not null, alter column user_id set default auth.uid();
alter table criteria add primary key (user_id);

alter table profile drop constraint profile_pkey;
alter table profile drop constraint profile_id_check;
alter table profile alter column id drop not null, alter column id drop default;
alter table profile alter column user_id set not null, alter column user_id set default auth.uid();
alter table profile add primary key (user_id);

-- A new member starts with default criteria and an empty profile.
create or replace function members_init() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into criteria (user_id, digest_email) values (new.user_id, new.email) on conflict (user_id) do nothing;
  insert into profile (user_id, email) values (new.user_id, new.email) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger members_init after insert on members for each row execute function members_init();

-- ---------------------------------------------------------------------------
-- Per-person columns: filled from the session by default, required from now on.
-- ---------------------------------------------------------------------------
alter table matches alter column user_id set default auth.uid();
alter table subscriptions alter column user_id set default auth.uid();
alter table feedback alter column user_id set default auth.uid(), alter column user_id set not null;
alter table answers alter column user_id set default auth.uid(), alter column user_id set not null;
-- Suggestions: not required yet, the single-user worker still writes them without one (step 3).
alter table source_suggestions alter column user_id set default auth.uid();
create index feedback_user_idx on feedback (user_id, created_at desc);

-- Suggestions are per person (the old (ats, slug) key is dropped in step 3).
alter table source_suggestions add constraint source_suggestions_user_ats_slug_key unique (user_id, ats, slug);

-- ---------------------------------------------------------------------------
-- Views: the signed-in person's jobs and sources, shaped like the old tables, so
-- pages read them almost unchanged. security_invoker: the base tables' RLS applies.
-- ---------------------------------------------------------------------------
create view my_jobs with (security_invoker = true) as
select
  j.id, j.source_id, j.external_id, j.title, j.company, j.location, j.remote, j.url, j.description,
  j.compensation, j.posted_at, j.first_seen_at, j.dedupe_key, j.thin, j.closed_at,
  m.id as match_id, m.status, m.status_changed_at, m.filter_reason, m.score, m.score_summary,
  m.score_pros, m.score_cons, m.scored_at, m.notified_at, m.applied_at, m.followed_up_at
from matches m
join jobs j on j.id = m.job_id
where m.user_id = auth.uid();

create view my_sources with (security_invoker = true) as
select
  s.id, s.ats, s.slug, s.country, s.last_checked_at, s.last_error, s.last_job_count, s.created_at,
  sub.company_name, sub.watchlist, sub.enabled, sub.created_at as subscribed_at
from subscriptions sub
join sources s on s.id = sub.source_id
where sub.user_id = auth.uid();

grant select on my_jobs, my_sources to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules: your own rows only.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profile', 'criteria', 'feedback', 'answers', 'source_suggestions'] loop
    execute format('drop policy owner_all on %I', t);
    execute format(
      'create policy own_rows on %I for all to authenticated
         using (user_id = auth.uid() and is_member()) with check (user_id = auth.uid() and is_member())', t);
  end loop;
end $$;

-- Shared postings: readable when you have a match for them; only the worker writes.
drop policy owner_all on jobs;
create policy jobs_read on jobs for select to authenticated
  using (is_member() and exists (select 1 from matches m where m.job_id = jobs.id and m.user_id = auth.uid()));
create policy jobs_admin_legacy on jobs for all to authenticated using (is_admin()) with check (is_admin());

-- Shared boards: readable when you follow them; added through subscribe_source().
drop policy owner_all on sources;
create policy sources_read on sources for select to authenticated
  using (is_member() and exists (select 1 from subscriptions s where s.source_id = sources.id and s.user_id = auth.uid()));
create policy sources_admin_legacy on sources for all to authenticated using (is_admin()) with check (is_admin());

-- Runs: the admin sees all; others see the runs that did something for them.
drop policy owner_all on runs;
create policy runs_read on runs for select to authenticated
  using (is_admin() or exists (select 1 from run_users r where r.run_id = runs.id and r.user_id = auth.uid()));

-- Credit tracking is the admin's Anthropic balance.
drop policy owner_all on credit_entries;
create policy credit_admin on credit_entries for all to authenticated using (is_admin()) with check (is_admin());

-- CV files: your own folder (<user_id>/...), or the file your profile points to
-- (the admin's CV predates folders).
drop policy cv_owner_select on storage.objects;
drop policy cv_owner_insert on storage.objects;
drop policy cv_owner_update on storage.objects;
drop policy cv_owner_delete on storage.objects;

create or replace function owns_cv(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member() and (
    (storage.foldername(object_name))[1] = auth.uid()::text
    or exists (select 1 from profile p where p.user_id = auth.uid() and p.cv_file_path = object_name)
  );
$$;
revoke execute on function owns_cv(text) from anon, public;
grant execute on function owns_cv(text) to authenticated;

create policy cv_own_select on storage.objects for select to authenticated using (bucket_id = 'cv' and owns_cv(name));
create policy cv_own_insert on storage.objects for insert to authenticated with check (bucket_id = 'cv' and owns_cv(name));
create policy cv_own_update on storage.objects for update to authenticated
  using (bucket_id = 'cv' and owns_cv(name)) with check (bucket_id = 'cv' and owns_cv(name));
create policy cv_own_delete on storage.objects for delete to authenticated using (bucket_id = 'cv' and owns_cv(name));

-- ---------------------------------------------------------------------------
-- Following and unfollowing sources. A board is stored once; following one someone
-- else already follows just subscribes (without revealing who else does).
-- ---------------------------------------------------------------------------
create or replace function subscribe_source(
  p_ats text, p_slug text, p_company_name text, p_country text default null, p_watchlist boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  added int;
begin
  if not is_member() then raise exception 'not a member'; end if;
  insert into sources (ats, slug, company_name, country)
  values (p_ats, p_slug, p_company_name, nullif(p_country, ''))
  on conflict (ats, slug) do nothing;
  select id into sid from sources where ats = p_ats and slug = p_slug;
  insert into subscriptions (user_id, source_id, company_name, watchlist)
  values (auth.uid(), sid, p_company_name, p_watchlist)
  on conflict (user_id, source_id) do nothing;
  get diagnostics added = row_count;
  return jsonb_build_object('source_id', sid, 'already', added = 0);
end;
$$;

-- Unfollowing removes the listings you haven't acted on; skipped ones and the
-- Pipeline stay. The board stays in the catalog (others may follow it).
create or replace function unsubscribe_source(p_source uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'not a member'; end if;
  delete from matches m using jobs j
  where m.job_id = j.id and j.source_id = p_source and m.user_id = auth.uid()
    and m.status in ('new', 'filtered', 'scored', 'closed');
  delete from subscriptions where user_id = auth.uid() and source_id = p_source;
end;
$$;

revoke execute on function subscribe_source(text, text, text, text, boolean), unsubscribe_source(uuid) from anon, public;
grant execute on function subscribe_source(text, text, text, text, boolean), unsubscribe_source(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Invites: the admin adds an email on the Members page; the worker (which has the
-- service-role and email keys the web app doesn't) creates the account and emails
-- a link to set a password, within ~15 minutes.
-- ---------------------------------------------------------------------------
create table invites (
  email text primary key,
  invited_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
alter table invites enable row level security;
create policy invites_admin on invites for all to authenticated using (is_admin()) with check (is_admin());
grant select, insert, update, delete on invites to authenticated;
grant all on invites to service_role;

-- Removing a member deletes their account and everything personal (matches,
-- subscriptions, criteria, profile, feedback, answers, run shares cascade).
-- Shared postings and boards stay. The admin can't remove themselves. (Their CV file
-- stays in storage: Supabase only deletes storage files through its API, not SQL.)
create or replace function remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  member_email text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_user = auth.uid() then raise exception 'you can''t remove yourself'; end if;
  select email into member_email from members where user_id = p_user;
  delete from auth.users where id = p_user;
  delete from invites where lower(email) = lower(member_email);
end;
$$;
revoke execute on function remove_member(uuid) from anon, public;
grant execute on function remove_member(uuid) to authenticated;
