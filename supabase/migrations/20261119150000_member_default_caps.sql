-- New members start with small AI spend caps: $0.01 per run, $0.05 per 24 hours
-- (about 30 and 150 listings with Haiku). Existing members keep theirs.
alter table members
  alter column max_run_cost_usd set default 0.01,
  alter column max_daily_cost_usd set default 0.05;
