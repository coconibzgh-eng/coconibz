alter table public.profiles
  add column if not exists avatar_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_avatar_path_owner_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_path_owner_check
      check (avatar_path is null or avatar_path like (id::text || '/%'));
  end if;
end;
$$;

grant update (avatar_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('site-marketing', 'site-marketing', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.coconibz_gallery_images (
  id uuid primary key default gen_random_uuid(),
  title text not null default '' check (length(title) <= 120),
  alt_text text not null check (length(btrim(alt_text)) between 1 and 200),
  object_path text not null unique,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.coconibz_promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  object_path text not null,
  target_url text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    target_url is null
    or target_url ~ '^https://[^[:space:]]+$'
    or (
      target_url ~ '^/[A-Za-z0-9_./#?=&%-]*$'
      and left(target_url, 2) <> '//'
    )
    or target_url ~ '^#[A-Za-z0-9_-]+$'
  )
);

create index coconibz_gallery_active_created_idx
  on public.coconibz_gallery_images (created_at desc)
  where is_active;

create index coconibz_promotions_active_created_idx
  on public.coconibz_promotions (created_at desc)
  where is_active;

alter table public.coconibz_gallery_images enable row level security;
alter table public.coconibz_promotions enable row level security;

revoke all on public.coconibz_gallery_images, public.coconibz_promotions from anon, authenticated;
grant select on public.coconibz_gallery_images, public.coconibz_promotions to anon, authenticated;
grant insert, update, delete on public.coconibz_gallery_images, public.coconibz_promotions to authenticated;

drop policy if exists "Public can view active gallery images and admins can view all"
  on public.coconibz_gallery_images;
create policy "Public can view active gallery images"
  on public.coconibz_gallery_images for select
  to anon, authenticated
  using (is_active);

create policy "Admins can view all gallery images"
  on public.coconibz_gallery_images for select
  to authenticated
  using ((select public.is_coconibz_admin()));

create policy "Admins manage gallery images"
  on public.coconibz_gallery_images for all
  to authenticated
  using ((select public.is_coconibz_admin()))
  with check ((select public.is_coconibz_admin()));

drop policy if exists "Public can view current promotions and admins can view all"
  on public.coconibz_promotions;
create policy "Public can view current promotions"
  on public.coconibz_promotions for select
  to anon, authenticated
  using (is_active);

create policy "Admins can view all promotions"
  on public.coconibz_promotions for select
  to authenticated
  using ((select public.is_coconibz_admin()));

create policy "Admins manage promotions"
  on public.coconibz_promotions for all
  to authenticated
  using ((select public.is_coconibz_admin()))
  with check ((select public.is_coconibz_admin()));

drop policy if exists "Users read own profile photos and admins read all"
  on storage.objects;
create policy "Users read own profile photos and admins read all"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_coconibz_admin())
    )
  );

drop policy if exists "Users upload own profile photos"
  on storage.objects;
create policy "Users upload own profile photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete own profile photos"
  on storage.objects;
create policy "Users delete own profile photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Admins manage site marketing images"
  on storage.objects;
create policy "Admins manage site marketing images"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'site-marketing'
    and (select public.is_coconibz_admin())
  )
  with check (
    bucket_id = 'site-marketing'
    and (select public.is_coconibz_admin())
  );

drop trigger if exists coconibz_audit_gallery_images on public.coconibz_gallery_images;
create trigger coconibz_audit_gallery_images
after insert or update or delete on public.coconibz_gallery_images
for each row execute function public.coconibz_record_audit_log();

drop trigger if exists coconibz_audit_promotions on public.coconibz_promotions;
create trigger coconibz_audit_promotions
after insert or update or delete on public.coconibz_promotions
for each row execute function public.coconibz_record_audit_log();

notify pgrst, 'reload schema';
