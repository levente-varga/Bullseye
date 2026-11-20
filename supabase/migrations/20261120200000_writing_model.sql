-- The model that writes: builds careers from CVs now, CV and cover letter drafts next.
-- Set by the admin next to the scoring model (settings is admin-only to change).
alter table settings
  add column writing_model text not null default 'claude-haiku-5-5'
    check (writing_model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'));
