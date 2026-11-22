-- Checklist scoring: the scorer rates each part of the fit (role, seniority, skills,
-- location, taste) 0-10 and the app combines them into the 0-100 score. The ratings
-- are kept per match so the Inbox can show why a job scored what it did.
-- [{ "key": "role", "rating": 8, "note": "Gameplay programmer, exact match" }, ...]
alter table matches add column score_checks jsonb;

-- Appending a column at the end keeps "create or replace view" valid.
create or replace view my_jobs with (security_invoker = true) as
select
  j.id, j.source_id, j.external_id, j.title, j.company, j.location, j.remote, j.url, j.description,
  j.compensation, j.posted_at, j.first_seen_at, j.dedupe_key, j.thin, j.closed_at,
  m.id as match_id, m.status, m.status_changed_at, m.filter_reason, m.score, m.score_summary,
  m.score_pros, m.score_cons, m.scored_at, m.notified_at, m.applied_at, m.followed_up_at,
  m.score_checks
from matches m
join jobs j on j.id = m.job_id
where m.user_id = (select auth.uid());
