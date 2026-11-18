-- Default AI spend caps for new members, set by the admin on the Members page (USD).
-- The worker applies them when it creates an invited member. Existing members keep theirs.
alter table settings
  add column default_run_cost_usd numeric(8, 2) not null default 0.01 check (default_run_cost_usd >= 0),
  add column default_daily_cost_usd numeric(8, 2) not null default 0.05 check (default_daily_cost_usd >= 0);
