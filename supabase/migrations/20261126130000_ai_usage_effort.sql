-- Cost estimates per thinking level: each AI task records the effort it ran at, so an
-- estimate averages tasks at the same model and level. Past tasks get what they ran at:
-- re-scores always used low; the writing tasks (CV import, drafts, cover letters and their
-- questions) ran at the model's default, which on Haiku 5.5 (the only writing model used
-- so far) is medium.
alter table ai_usage
  add column effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max'));
update ai_usage set effort = case when kind = 'rescore' then 'low' else 'medium' end where effort is null;
create index if not exists ai_usage_estimate_idx on ai_usage (kind, model, effort, created_at desc);
