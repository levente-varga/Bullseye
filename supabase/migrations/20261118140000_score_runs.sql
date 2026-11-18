-- "score" runs: describe and score jobs already waiting (after a re-evaluation, or
-- more than one run's cap), without fetching sources.
alter table runs drop constraint runs_kind_check;
alter table runs add constraint runs_kind_check check (kind in ('watchlist', 'full', 'score', 'digest'));
