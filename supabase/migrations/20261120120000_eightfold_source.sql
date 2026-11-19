-- Eightfold career sites (Netflix and other large employers).
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday', 'pinpoint', 'jobylon', 'apple', 'avature',
    'hibob', 'breezy', 'bamboohr', 'eightfold',
    'jobtech', 'swedengamejobs',
    'himalayas', 'workingnomads', 'remoteok', 'weworkremotely', 'arbeitnow', 'workwithindies',
    'jobindex', 'magnetme', 'berlinstartupjobs', 'landingjobs', 'jobsch'
  ));
