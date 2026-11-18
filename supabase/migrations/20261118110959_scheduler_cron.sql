-- Reliable heartbeat for the worker.
--
-- GitHub's own cron for public repos is best-effort: in practice it fired once in
-- nine hours. A workflow_dispatch request is started right away, so Supabase sends
-- one every 15 minutes. The worker then runs whatever the schedule on the Criteria
-- page says is due (often nothing). GitHub's cron stays in the workflow as a
-- backup; overlapping runs queue in the workflow's concurrency group and find
-- nothing left to do.
--
-- Needs a Vault secret named `github_dispatch_token`: a fine-grained GitHub token
-- for this repo only, with "Actions: read and write". Without it, nothing is sent.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Asks GitHub to start the Scheduler workflow in "tick" mode. Returns the pg_net
-- request id (the response lands in net._http_response; GitHub answers 204).
create or replace function public.dispatch_scheduler()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if token is null then
    raise warning 'dispatch_scheduler: Vault secret github_dispatch_token is missing';
    return null;
  end if;

  return net.http_post(
    url := 'https://api.github.com/repos/levente-varga/Bullseye/actions/workflows/scheduler.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('mode', 'tick')),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'bullseye-scheduler',
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

-- Only the database itself (pg_cron) may call it: not exposed through the API.
revoke execute on function public.dispatch_scheduler() from public, anon, authenticated;

-- Minutes 2, 17, 32, 47: just after GitHub's own (late, if ever) quarter-hour slots.
-- cron.schedule with a name replaces an existing job of that name, so this is re-runnable.
select cron.schedule('bullseye-scheduler', '2,17,32,47 * * * *', $$select public.dispatch_scheduler()$$);
