-- Faster pages. Counts went through my_jobs, which joins the wide jobs rows (descriptions,
-- search text) and runs jobs' row policy (an EXISTS on matches) once per job; Sources even
-- ran one such count per source. These functions count the caller's own rows in one round
-- trip, straight from matches. They are security definer so the per-row policies don't run,
-- and filter on auth.uid() themselves, so they only ever see the caller's data.

-- Lets "match → its source" be read from the index alone, without the wide job rows.
create index if not exists jobs_id_source_idx on jobs (id) include (source_id);

-- Open listings per source (Sources page): waiting, scored or in the pipeline.
create or replace function public.my_open_counts()
returns table (source_id uuid, open bigint)
language sql stable security definer set search_path = public as $$
  select j.source_id, count(*)
  from matches m
  join jobs j on j.id = m.job_id
  where m.user_id = auth.uid()
    and is_member()
    and m.status not in ('closed', 'filtered')
    and j.source_id is not null
  group by j.source_id
$$;

-- The sidebar numbers in one call: Inbox (scored at or above the threshold), Pipeline
-- (open stages), enabled sources, and new addable suggestions.
create or replace function public.my_nav_counts()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'inbox', (
      select count(*) from matches m
      where m.user_id = auth.uid() and m.status = 'scored'
        and m.score >= coalesce((select c.score_threshold from criteria c where c.user_id = auth.uid()), 60)
    ),
    'pipeline', (
      select count(*) from matches m
      where m.user_id = auth.uid() and m.status in ('approved', 'applied', 'interview', 'offer')
    ),
    'sources', (select count(*) from subscriptions s where s.user_id = auth.uid() and s.enabled),
    'suggestions', (
      select count(*) from source_suggestions g
      where g.user_id = auth.uid() and g.status = 'new' and g.ats <> 'custom'
    )
  )
  where is_member()
$$;

revoke all on function public.my_open_counts() from public;
revoke all on function public.my_nav_counts() from public;
grant execute on function public.my_open_counts() to authenticated;
grant execute on function public.my_nav_counts() to authenticated;
