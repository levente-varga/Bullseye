-- Jobs added by hand (Pipeline → Add a job): for postings no source can read (sites that
-- disallow bots, a job a friend sent). They have no source; the worker never fetches,
-- closes or scores them. They go straight into the person's Pipeline.
alter table jobs alter column source_id drop not null;

-- Adds a job by hand for the caller and puts it in their Pipeline ("approved"). If the
-- posting is already known (same dedupe key, computed by the app from the link), that job
-- is reused, and gets the description if it had none. An existing match moves into the
-- Pipeline unless it's already further along.
create or replace function add_manual_job(
  p_url text, p_title text, p_company text, p_location text, p_remote boolean, p_description text, p_dedupe text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  jid uuid;
begin
  if not is_member() then raise exception 'not a member'; end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_company, '')) = '' or btrim(coalesce(p_url, '')) = '' then
    raise exception 'title, company and link are required';
  end if;

  if p_dedupe is not null and p_dedupe <> '' then
    select id into jid from jobs where dedupe_key = p_dedupe order by first_seen_at limit 1;
  end if;
  if jid is null then
    insert into jobs (source_id, external_id, title, company, location, remote, url, description, dedupe_key, thin)
    values (
      null, 'manual:' || gen_random_uuid(), btrim(p_title), btrim(p_company), btrim(coalesce(p_location, '')),
      coalesce(p_remote, false), btrim(p_url), coalesce(p_description, ''), nullif(p_dedupe, ''),
      length(coalesce(p_description, '')) < 300
    )
    returning id into jid;
  elsif coalesce(p_description, '') <> '' then
    update jobs set description = p_description, thin = length(p_description) < 300 where id = jid and description = '';
  end if;

  insert into matches (user_id, job_id, status)
  values (auth.uid(), jid, 'approved')
  on conflict (user_id, job_id) do update set status = 'approved'
    where matches.status not in ('approved', 'applied', 'interview', 'offer');
  return jid;
end $$;

revoke execute on function add_manual_job(text, text, text, text, boolean, text, text) from anon, public;
grant execute on function add_manual_job(text, text, text, text, boolean, text, text) to authenticated;
