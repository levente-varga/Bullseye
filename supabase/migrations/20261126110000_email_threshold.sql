-- Emails (the daily digest and watchlist alerts) get their own score threshold, separate
-- from the Inbox's: e.g. see 60+ in the Inbox but only be emailed about 80+.
-- Everyone starts at their current Inbox threshold, so nothing changes until they set it.
alter table criteria
  add column email_threshold int not null default 60 check (email_threshold between 0 and 100);
update criteria set email_threshold = score_threshold;
