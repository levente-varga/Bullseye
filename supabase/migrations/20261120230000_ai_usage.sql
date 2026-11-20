-- AI spend outside runs: CV imports now, CV and cover letter drafts next. One row per
-- task, with the model, tokens and cost, so the Report can list them, the credit chart
-- can subtract them, and the 24-hour spend caps count them.
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null, -- "career_import", later "cv_draft", "cover_letter"
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  detail text not null default '', -- e.g. the PDF's name
  created_at timestamptz not null default now()
);
create index ai_usage_user_created_idx on ai_usage (user_id, created_at desc);
create index ai_usage_created_idx on ai_usage (created_at desc);

alter table ai_usage enable row level security;
-- Your own tasks; the admin sees everyone's (it's all on the admin's API key).
create policy ai_usage_read on ai_usage for select to authenticated
  using ((user_id = (select auth.uid()) and (select is_member())) or (select is_admin()));
-- Recorded by the app as the person who ran the task.
create policy ai_usage_insert on ai_usage for insert to authenticated
  with check (user_id = (select auth.uid()) and (select is_member()));

grant select, insert on ai_usage to authenticated;
grant all on ai_usage to service_role;
