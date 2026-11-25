-- A posting whose description couldn't be read is "thin" (scored on title and location
-- only). The daily run now retries those still open in someone's Inbox: once a day, at
-- most a few times, so a fetch that failed for a moment (e.g. a site rate-limiting a big
-- first import) doesn't leave the job thin for good.
alter table jobs
  add column describe_attempts int not null default 0,
  add column described_at timestamptz;
