-- Per-person AI balances on the admin's Anthropic key. The admin grants each member credit
-- (Members page); a member's balance is what they were granted minus what they spent (their
-- share of runs plus their other AI tasks). At zero their scoring and AI tasks stop. The
-- admin draws on the account directly (credit_entries: the real Anthropic top-ups).
create table credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references members (user_id) on delete cascade,
  amount_usd numeric(12, 4) not null, -- negative for a correction
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index credit_grants_user_idx on credit_grants (user_id, created_at);

alter table credit_grants enable row level security;
create policy credit_grants_read on credit_grants for select to authenticated
  using ((user_id = (select auth.uid()) and (select is_member())) or (select is_admin()));
create policy credit_grants_admin on credit_grants for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
grant select, insert, update, delete on credit_grants to authenticated;
grant all on credit_grants to service_role;

-- Each member's granted, spent and balance. Runs as the caller (RLS): a member sees their
-- own row, the admin everyone's, the worker (service role) all.
create view member_balances with (security_invoker = true) as
select
  m.user_id,
  m.email,
  m.is_admin,
  coalesce(g.granted, 0)::numeric(12, 4) as granted_usd,
  (coalesce(r.spent, 0) + coalesce(a.spent, 0))::numeric(12, 4) as spent_usd,
  (coalesce(g.granted, 0) - coalesce(r.spent, 0) - coalesce(a.spent, 0))::numeric(12, 4) as balance_usd
from members m
left join (select user_id, sum(amount_usd) as granted from credit_grants group by user_id) g on g.user_id = m.user_id
left join (select user_id, sum((stats ->> 'cost_usd')::numeric) as spent from run_users group by user_id) r on r.user_id = m.user_id
left join (select user_id, sum(cost_usd) as spent from ai_usage group by user_id) a on a.user_id = m.user_id;

grant select on member_balances to authenticated, service_role;
