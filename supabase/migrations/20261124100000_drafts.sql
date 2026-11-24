-- CV and cover letter drafts: each person's draft settings and photo, and the drafts
-- themselves (one current CV and one current letter per job).

alter table profile
  add column photo_path text,                                   -- in the private "photos" bucket
  add column draft_language text not null default 'en',         -- en, sv, de, hu
  add column cv_photo boolean not null default false,           -- put the photo on CVs
  add column cv_length text not null default 'one_page'
    check (cv_length in ('one_page', 'two_pages')),
  add column letter_questions boolean not null default true;    -- ask 1-2 questions before a letter

create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  kind text not null check (kind in ('cv', 'cover_letter')),
  language text not null default 'en',
  content jsonb,                -- the draft (null while a letter waits for its questions)
  answers jsonb,                -- cover letter: [{ "question": "...", "answer": "..." }]
  model text,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id, kind)
);

alter table drafts enable row level security;
create policy drafts_own on drafts for all to authenticated
  using (user_id = (select auth.uid()) and (select is_member()))
  with check (user_id = (select auth.uid()) and (select is_member()));
grant select, insert, update, delete on drafts to authenticated;
grant all on drafts to service_role;

-- Private bucket for profile photos: 2 MB, JPEG or PNG, at <user id>/photo.<ext>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy photos_own_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select is_member()));
create policy photos_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select is_member()));
create policy photos_own_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select is_member()))
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select is_member()));
create policy photos_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select is_member()));
