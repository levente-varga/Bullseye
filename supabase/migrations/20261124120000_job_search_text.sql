-- Gentler Inbox search: "goteborg" finds "Göteborg", "zurich" finds "Zürich". Each job
-- keeps an accent-free, lower-case copy of its searchable text (title, company, location,
-- description), kept up to date by Postgres; the app strips accents from the typed words too.
create extension if not exists unaccent with schema extensions;

-- unaccent() isn't marked immutable (its dictionary could change), so a generated column
-- can't call it directly; this wrapper with a fixed dictionary can.
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

alter table jobs add column search_text text generated always as (
  public.f_unaccent(lower(
    coalesce(title, '') || ' ' || coalesce(company, '') || ' ' || coalesce(location, '') || ' ' || coalesce(description, '')
  ))
) stored;

-- Appending a column at the end keeps "create or replace view" valid.
create or replace view my_jobs with (security_invoker = true) as
select
  j.id, j.source_id, j.external_id, j.title, j.company, j.location, j.remote, j.url, j.description,
  j.compensation, j.posted_at, j.first_seen_at, j.dedupe_key, j.thin, j.closed_at,
  m.id as match_id, m.status, m.status_changed_at, m.filter_reason, m.score, m.score_summary,
  m.score_pros, m.score_cons, m.scored_at, m.notified_at, m.applied_at, m.followed_up_at,
  m.score_checks,
  j.search_text
from matches m
join jobs j on j.id = m.job_id
where m.user_id = (select auth.uid());
