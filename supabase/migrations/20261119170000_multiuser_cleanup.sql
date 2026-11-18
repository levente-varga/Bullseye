-- Multi-user, step 3 of 3: remove what kept the single-user app working during the
-- switch. Everything here was replaced in steps 1 and 2 and verified by a full run.

-- The shared settings row (the backfill made it on existing installs; fresh ones need it).
insert into settings (id) values (1) on conflict (id) do nothing;

-- The backfill copied single-user data once; it reads the columns dropped below.
drop function if exists backfill_multiuser();

-- jobs: the personal columns moved to matches (one row per person and posting).
drop trigger if exists jobs_touch_status on jobs;
alter table jobs
  drop column status,
  drop column status_changed_at,
  drop column filter_reason,
  drop column score,
  drop column score_summary,
  drop column score_pros,
  drop column score_cons,
  drop column scored_at,
  drop column notified_at,
  drop column applied_at,
  drop column followed_up_at;

-- criteria: the schedule and model moved to settings, the caps to members; rows are
-- keyed by user_id, so the old id = 1 column goes too.
alter table criteria
  drop column id,
  drop column scoring_model,
  drop column watch_interval_minutes,
  drop column daily_time,
  drop column daily_enabled,
  drop column timezone,
  drop column max_run_cost_usd,
  drop column max_daily_cost_usd;
alter table profile drop column id;

-- sources: following, watching and pausing are per person (subscriptions).
alter table sources drop column watchlist, drop column enabled;

-- The admin's temporary write access to shared tables; only the worker writes them now.
drop policy if exists jobs_admin_legacy on jobs;
drop policy if exists sources_admin_legacy on sources;

-- Suggestions are per person: the old global key would stop two people getting the
-- same suggestion, and every row has an owner now.
alter table source_suggestions drop constraint if exists source_suggestions_ats_slug_key;
delete from source_suggestions where user_id is null;
alter table source_suggestions alter column user_id set not null;

-- Access is membership now (members, is_member()).
drop function if exists is_allowed();
drop table if exists allowed_users;
