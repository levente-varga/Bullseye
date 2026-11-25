-- Sources read through the key or token a site gives every visitor: Cornerstone OnDemand
-- (Nintendo Europe), Comeet (Overwolf) and MED-EL's own careers app.
alter table sources drop constraint sources_ats_check;
alter table sources add constraint sources_ats_check
  check (ats in (
    'greenhouse', 'lever', 'ashby', 'teamtailor', 'smartrecruiters',
    'personio', 'recruitee', 'workable', 'workday', 'pinpoint', 'jobylon', 'apple', 'avature',
    'hibob', 'breezy', 'bamboohr', 'phenom', 'rippling', 'inrecruiting', 'successfactors', 'eightfold',
    'radancy', 'haileyhr',
    'oracle', 'taleo', 'gem', 'manatal', 'traffit', 'join', 'jobvite', 'softgarden', 'trakstar',
    'homerun', 'jazzhr', 'cornerstone', 'comeet', 'medel',
    'jobtech', 'swedengamejobs',
    'himalayas', 'workingnomads', 'remoteok', 'weworkremotely', 'arbeitnow', 'workwithindies',
    'jobindex', 'magnetme', 'berlinstartupjobs', 'landingjobs', 'jobsch'
  ));
