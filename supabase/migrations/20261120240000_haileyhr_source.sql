-- HaileyHR career pages (Swedish HR system).
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday', 'pinpoint', 'jobylon', 'apple', 'avature',
    'hibob', 'breezy', 'bamboohr', 'phenom', 'rippling', 'inrecruiting', 'successfactors', 'eightfold',
    'radancy', 'haileyhr',
    'jobtech', 'swedengamejobs',
    'himalayas', 'workingnomads', 'remoteok', 'weworkremotely', 'arbeitnow', 'workwithindies',
    'jobindex', 'magnetme', 'berlinstartupjobs', 'landingjobs', 'jobsch'
  ));
