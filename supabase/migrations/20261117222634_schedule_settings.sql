-- When the worker runs, editable on the Criteria page. GitHub Actions only wakes the
-- worker up every 15 minutes; it reads these and runs whatever is due.
-- Defaults match the previous fixed schedule (watchlist hourly, daily run ~05:30 UTC).
alter table criteria
  add column watch_interval_minutes int not null default 60
    check (watch_interval_minutes in (0, 15, 30, 60, 120, 240, 360, 720)), -- 0 = off
  add column daily_time text not null default '05:30'
    check (daily_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column daily_enabled boolean not null default true,
  add column timezone text not null default 'UTC';
