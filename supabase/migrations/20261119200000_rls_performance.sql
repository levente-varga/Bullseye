-- Faster access rules. The policies called auth.uid(), is_member() and is_admin() once per
-- row; is_member() and is_admin() are security-definer functions that run a query each
-- time, so counting ~33k matches took seconds. Wrapped in (select ...) they're evaluated
-- once per query (Supabase's RLS performance advice). Same rules, same results.

do $$
declare t text;
begin
  foreach t in array array['profile', 'criteria', 'feedback', 'answers', 'source_suggestions'] loop
    execute format('drop policy own_rows on %I', t);
    execute format(
      'create policy own_rows on %I for all to authenticated
         using (user_id = (select auth.uid()) and (select is_member()))
         with check (user_id = (select auth.uid()) and (select is_member()))', t);
  end loop;
end $$;

drop policy matches_own on matches;
create policy matches_own on matches for all to authenticated
  using (user_id = (select auth.uid()) and (select is_member()))
  with check (user_id = (select auth.uid()) and (select is_member()));

drop policy subscriptions_own on subscriptions;
create policy subscriptions_own on subscriptions for all to authenticated
  using (user_id = (select auth.uid()) and (select is_member()))
  with check (user_id = (select auth.uid()) and (select is_member()));

drop policy jobs_read on jobs;
create policy jobs_read on jobs for select to authenticated
  using ((select is_member()) and exists (select 1 from matches m where m.job_id = jobs.id and m.user_id = (select auth.uid())));

drop policy sources_read on sources;
create policy sources_read on sources for select to authenticated
  using ((select is_member()) and exists (select 1 from subscriptions s where s.source_id = sources.id and s.user_id = (select auth.uid())));

drop policy run_users_read on run_users;
create policy run_users_read on run_users for select to authenticated
  using ((user_id = (select auth.uid()) and (select is_member())) or (select is_admin()));

drop policy runs_read on runs;
create policy runs_read on runs for select to authenticated
  using ((select is_admin()) or exists (select 1 from run_users r where r.run_id = runs.id and r.user_id = (select auth.uid())));

drop policy members_read on members;
create policy members_read on members for select to authenticated
  using (user_id = (select auth.uid()) or (select is_admin()));
drop policy members_admin on members;
create policy members_admin on members for all to authenticated using ((select is_admin())) with check ((select is_admin()));

drop policy settings_read on settings;
create policy settings_read on settings for select to authenticated using ((select is_member()));
drop policy settings_admin on settings;
create policy settings_admin on settings for update to authenticated using ((select is_admin())) with check ((select is_admin()));

drop policy credit_admin on credit_entries;
create policy credit_admin on credit_entries for all to authenticated using ((select is_admin())) with check ((select is_admin()));

drop policy invites_admin on invites;
create policy invites_admin on invites for all to authenticated using ((select is_admin())) with check ((select is_admin()));

-- The views filter by the caller once per query too.
create or replace view my_jobs with (security_invoker = true) as
select
  j.id, j.source_id, j.external_id, j.title, j.company, j.location, j.remote, j.url, j.description,
  j.compensation, j.posted_at, j.first_seen_at, j.dedupe_key, j.thin, j.closed_at,
  m.id as match_id, m.status, m.status_changed_at, m.filter_reason, m.score, m.score_summary,
  m.score_pros, m.score_cons, m.scored_at, m.notified_at, m.applied_at, m.followed_up_at
from matches m
join jobs j on j.id = m.job_id
where m.user_id = (select auth.uid());
