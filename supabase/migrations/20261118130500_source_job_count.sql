-- How many listings a source returned on its last successful check. An aggregator
-- that suddenly returns none (usually a site redesign) is then flagged as failing.
alter table sources add column last_job_count integer;
