-- Where digest and watchlist emails go, editable from the dashboard.
-- Empty means fall back to the DIGEST_TO env var of the worker.
alter table criteria add column digest_email text not null default '';
