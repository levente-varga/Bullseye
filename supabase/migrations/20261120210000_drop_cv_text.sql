-- The career (profile.career) replaces the CV: the scorer reads it, and a CV PDF only
-- fills it in (read in memory, not kept). So the CV text, the stored PDF's columns and
-- the storage rules for it go. The "cv" bucket itself stays (Supabase won't drop a bucket
-- with files from SQL); remove any file from the Profile page or the dashboard first.
drop policy if exists cv_own_select on storage.objects;
drop policy if exists cv_own_insert on storage.objects;
drop policy if exists cv_own_update on storage.objects;
drop policy if exists cv_own_delete on storage.objects;
drop function if exists owns_cv(text);

alter table profile
  drop column if exists cv_text,
  drop column if exists cv_file_path,
  drop column if exists cv_file_name,
  drop column if exists cv_uploaded_at;
