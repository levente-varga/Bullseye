-- Aggregators are followed from a catalog, not configured: each is one shared source with
-- a fixed slug. Searchable ones (Platsbanken, Himalayas, Jobindex, jobs.ch) are searched
-- with their followers' target roles; the rest fetch their whole board. The old per-source
-- search settings (q=developer, jobFunctions=IT, a category) are replaced by those.
update sources set slug = 'platsbanken' where ats = 'jobtech';
update sources set slug = 'himalayas.app' where ats = 'himalayas';
update sources set slug = 'weworkremotely.com' where ats = 'weworkremotely';
update sources set slug = 'jobindex.dk' where ats = 'jobindex';
update sources set slug = 'magnet.me' where ats = 'magnetme';
update sources set slug = 'berlinstartupjobs.com' where ats = 'berlinstartupjobs';
update sources set slug = 'jobs.ch' where ats = 'jobsch';
