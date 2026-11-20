-- New listings per day for the Report chart: the caller's matches by the day they came
-- in (in the given timezone), split into those that passed their filters and those
-- filtered out. Counted here so the page doesn't load ~30k rows. Runs as the caller
-- (security invoker), so RLS limits it to their own matches.
create or replace function my_new_per_day(p_days int default 30, p_tz text default 'UTC')
returns table (day date, passed bigint, filtered bigint)
language sql stable security invoker set search_path = public as $$
  select
    (m.created_at at time zone p_tz)::date as day,
    count(*) filter (where m.status <> 'filtered') as passed,
    count(*) filter (where m.status = 'filtered') as filtered
  from matches m
  where m.user_id = (select auth.uid())
    -- from midnight (in p_tz) of the first of the last p_days days
    and m.created_at >= (((now() at time zone p_tz)::date - (p_days - 1))::timestamp at time zone p_tz)
  group by 1
  order by 1;
$$;

revoke execute on function my_new_per_day(int, text) from anon, public;
grant execute on function my_new_per_day(int, text) to authenticated;
