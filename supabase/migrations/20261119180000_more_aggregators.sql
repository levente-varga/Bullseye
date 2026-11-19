-- More aggregators: Jobindex (Denmark), Magnet.me (NL/BE, students and graduates),
-- Berlin Startup Jobs, Landing.jobs (Portugal and European tech) and jobs.ch (Switzerland).
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday', 'pinpoint', 'jobylon',
    'jobtech', 'swedengamejobs',
    'himalayas', 'workingnomads', 'remoteok', 'weworkremotely', 'arbeitnow', 'workwithindies',
    'jobindex', 'magnetme', 'berlinstartupjobs', 'landingjobs', 'jobsch'
  ));
