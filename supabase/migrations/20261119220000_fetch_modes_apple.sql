-- How much a source costs to fetch, and Apple's careers site.
--  - last_request_count: HTTP requests the last successful fetch made (shown on Sources,
--    and multiplied by the watchlist interval for watched sources).
--  - last_success_at: when the last fetch succeeded. Apple reads its newest postings back
--    to this point (last_checked_at also moves on failures).
--  - 'apple': jobs.apple.com, read newest first.
alter table sources add column last_request_count int;
alter table sources add column last_success_at timestamptz;
update sources set last_success_at = last_checked_at where last_error is null and last_checked_at is not null;

alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday', 'pinpoint', 'jobylon', 'apple',
    'jobtech', 'swedengamejobs',
    'himalayas', 'workingnomads', 'remoteok', 'weworkremotely', 'arbeitnow', 'workwithindies',
    'jobindex', 'magnetme', 'berlinstartupjobs', 'landingjobs', 'jobsch'
  ));

-- my_sources gains the request count (columns can only be appended to a view).
create or replace view my_sources with (security_invoker = true) as
select
  s.id, s.ats, s.slug, s.country, s.last_checked_at, s.last_error, s.last_job_count, s.created_at,
  sub.company_name, sub.watchlist, sub.enabled, sub.created_at as subscribed_at,
  s.last_request_count
from subscriptions sub
join sources s on s.id = sub.source_id
where sub.user_id = (select auth.uid());
