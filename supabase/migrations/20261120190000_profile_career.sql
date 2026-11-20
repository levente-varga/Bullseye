-- A structured career on each profile: experiences, education, skills, languages and
-- awards, extracted from the CV text (and optionally a website) by the model, then
-- reviewed and edited on the Profile page. The CV text stays what the scorer reads.
alter table profile add column career jsonb;
alter table profile add column career_updated_at timestamptz;
