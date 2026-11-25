-- Each person sets their own spend caps (per run, per 24 hours) on the Criteria page; the
-- admin no longer sets members' caps. Members are only limited by these and their balance.
-- The members table stays admin-write (it also holds is_admin), so this function changes
-- just the caller's two cap columns.
create or replace function public.set_my_spend_caps(p_run numeric, p_daily numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then
    raise exception 'not a member';
  end if;
  if p_run is null or p_daily is null or p_run < 0 or p_daily < 0 then
    raise exception 'caps must be 0 or more';
  end if;
  update members
     set max_run_cost_usd = round(p_run, 2), max_daily_cost_usd = round(p_daily, 2)
   where user_id = auth.uid();
end
$$;

revoke all on function public.set_my_spend_caps(numeric, numeric) from public;
grant execute on function public.set_my_spend_caps(numeric, numeric) to authenticated;
