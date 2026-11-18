-- More aggregators: remote boards (Himalayas, Working Nomads, Remote OK, We Work Remotely),
-- Europe (Arbeitnow) and games (Work With Indies).
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday', 'pinpoint',
    'jobtech', 'swedengamejobs',
    'himalayas', 'workingnomads', 'remoteok', 'weworkremotely', 'arbeitnow', 'workwithindies'
  ));

-- Spend caps for AI scoring: per run and per rolling 24 hours (USD). Listings over the
-- cap stay waiting and are scored once there's budget again.
alter table criteria
  add column max_run_cost_usd numeric(8, 2) not null default 0.25 check (max_run_cost_usd >= 0),
  add column max_daily_cost_usd numeric(8, 2) not null default 1.00 check (max_daily_cost_usd >= 0);
