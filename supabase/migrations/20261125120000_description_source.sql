-- Where an aggregator listing's description came from: the company's own posting
-- ("company"), which is read first when the aggregator links to it, or the aggregator's
-- text ("aggregator"). Null for direct sources. Shown as a badge in the opened Inbox row.
alter table jobs add column description_source text check (description_source in ('company', 'aggregator'));

-- Appending a column at the end keeps "create or replace view" valid.
create or replace view my_jobs with (security_invoker = true) as
select
  j.id, j.source_id, j.external_id, j.title, j.company, j.location, j.remote, j.url, j.description,
  j.compensation, j.posted_at, j.first_seen_at, j.dedupe_key, j.thin, j.closed_at,
  m.id as match_id, m.status, m.status_changed_at, m.filter_reason, m.score, m.score_summary,
  m.score_pros, m.score_cons, m.scored_at, m.notified_at, m.applied_at, m.followed_up_at,
  m.score_checks,
  j.search_text,
  j.description_source
from matches m
join jobs j on j.id = m.job_id
where m.user_id = (select auth.uid());
