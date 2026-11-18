-- JobTech / Platsbanken (Sweden's public job ads) as an aggregator source.
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday',
    'jobtech', 'swedengamejobs'
  ));
