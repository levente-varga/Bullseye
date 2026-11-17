-- Which Claude model scores listings, picked on the Criteria page.
alter table criteria add column scoring_model text not null default 'claude-haiku-5-5'
  check (scoring_model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'));
