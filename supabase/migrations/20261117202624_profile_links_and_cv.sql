-- Structured profile links and an uploaded CV file.

-- Named links, so application forms can be pre-filled field by field later.
-- The existing `links` column stays and now means "other links".
alter table profile add column linkedin_url text not null default '';
alter table profile add column github_url text not null default '';
alter table profile add column website_url text not null default '';

-- The uploaded CV (a PDF in the private "cv" storage bucket). cv_text stays the
-- text the scorer reads, filled from the PDF on upload and editable.
alter table profile add column cv_file_path text;
alter table profile add column cv_file_name text;
alter table profile add column cv_uploaded_at timestamptz;

-- Private bucket for CV files: 5 MB, PDF only, no public URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv', 'cv', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Only allowed users can read, upload, replace or delete files in it.
create policy cv_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'cv' and is_allowed());
create policy cv_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cv' and is_allowed());
create policy cv_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'cv' and is_allowed()) with check (bucket_id = 'cv' and is_allowed());
create policy cv_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cv' and is_allowed());
