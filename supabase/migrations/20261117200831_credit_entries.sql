-- Anthropic credit balance, entered by hand (there's no API for it).
-- Each row is "the Console showed this balance at this time": a top-up or a
-- correction. The Report subtracts recorded run costs since the latest entry.
create table credit_entries (
  id uuid primary key default gen_random_uuid(),
  entered_at timestamptz not null default now(),
  balance_usd numeric(10, 2) not null check (balance_usd >= 0),
  note text
);

create index credit_entries_entered_idx on credit_entries (entered_at);

alter table credit_entries enable row level security;
create policy owner_all on credit_entries for all to authenticated
  using (is_allowed()) with check (is_allowed());
grant select, insert, update, delete on credit_entries to authenticated;
grant all on credit_entries to service_role;
