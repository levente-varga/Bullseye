-- How hard each model thinks (Settings → AI, under each model picker): Claude's "effort"
-- (low, medium, high, xhigh, max). More effort means more thinking, which is billed as
-- output. Defaults keep what ran before: scoring at low, writing at medium.
alter table settings
  add column scoring_effort text not null default 'low' check (scoring_effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  add column writing_effort text not null default 'medium' check (writing_effort in ('low', 'medium', 'high', 'xhigh', 'max'));
