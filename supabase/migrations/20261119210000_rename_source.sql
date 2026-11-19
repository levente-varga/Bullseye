-- Renaming a source. Your label (subscriptions.company_name) always changes. The shared
-- name (sources.company_name, which the worker stamps on new postings) and the company on
-- postings already fetched under it change too when you're the board's only follower or
-- the admin, so one person can't rename a board everyone sees.
create or replace function rename_source(p_source uuid, p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  new_name text := btrim(p_name);
  old_name text;
  others int;
begin
  if not is_member() then raise exception 'not a member'; end if;
  if new_name = '' or length(new_name) > 120 then raise exception 'invalid name'; end if;

  update subscriptions set company_name = new_name where user_id = auth.uid() and source_id = p_source;
  if not found then raise exception 'not following this source'; end if;

  select count(*) into others from subscriptions where source_id = p_source and user_id <> auth.uid();
  if others > 0 and not is_admin() then return false; end if;

  select company_name into old_name from sources where id = p_source;
  update sources set company_name = new_name where id = p_source;
  -- Only postings that carry the board's old name: an aggregator's postings name their own
  -- companies and stay as they are.
  update jobs set company = new_name where source_id = p_source and company = old_name;
  return true;
end $$;

revoke execute on function rename_source(uuid, text) from anon, public;
grant execute on function rename_source(uuid, text) to authenticated;
