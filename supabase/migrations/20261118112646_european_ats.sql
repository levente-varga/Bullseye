-- New source types: Personio, Recruitee, Workable and Workday career sites.
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday',
    'swedengamejobs'
  ));
