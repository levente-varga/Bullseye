-- Cost estimates on AI buttons average the tokens of the last few tasks and price them at
-- the model the setting points to now. Cache reads cost a tenth of normal input and cache
-- writes 1.25x, so the split is kept: tokens_in stays the total input, these are its parts.
alter table ai_usage
  add column tokens_cache_write int not null default 0,
  add column tokens_cache_read int not null default 0;
