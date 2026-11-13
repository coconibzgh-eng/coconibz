begin;

create table public.retailer_invite_codes (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops (id) on delete restrict,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{32}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  check (used_at is null or revoked_at is null)
);

create index retailer_invite_codes_created_idx
  on public.retailer_invite_codes (created_at desc);

alter table public.retailer_invite_codes enable row level security;
revoke all on public.retailer_invite_codes from anon, authenticated;
grant select on public.retailer_invite_codes to authenticated;

create policy "Admins view retailer invite codes"
on public.retailer_invite_codes for select to authenticated
using ((select public.is_coconibz_admin()));

create trigger coconibz_audit_retailer_invite_codes
after insert or update on public.retailer_invite_codes
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_profile_role
after update of role on public.profiles
for each row
when (old.role is distinct from new.role)
execute function public.coconibz_record_audit_log();

create or replace function public.coconibz_admin_create_retailer_invite(
  p_shop_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_code text;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can create retailer invite codes';
  end if;
  if p_shop_id is null or not exists (
    select 1 from public.shops as shop where shop.id = p_shop_id
  ) then
    raise exception 'Choose a valid retailer shop';
  end if;

  invite_code := 'CNZ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));

  insert into public.retailer_invite_codes (shop_id, code_hash, created_by)
  values (
    p_shop_id,
    md5(replace(invite_code, '-', '')),
    auth.uid()
  );

  return invite_code;
end;
$$;

create or replace function public.coconibz_redeem_retailer_invite(
  p_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text;
  invite public.retailer_invite_codes%rowtype;
  user_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before redeeming a retailer invite code';
  end if;

  normalized_code := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  if normalized_code !~ '^CNZ[0-9A-F]{24}$' then
    raise exception 'Enter a valid retailer invite code';
  end if;

  select code.*
  into invite
  from public.retailer_invite_codes as code
  where code.code_hash = md5(normalized_code)
    and code.used_at is null
    and code.revoked_at is null
  for update;
  if not found then
    raise exception 'This retailer invite code is invalid, used, or revoked';
  end if;

  select profile.role
  into user_role
  from public.profiles as profile
  where profile.id = auth.uid()
  for update;
  if not found then
    raise exception 'Your account profile could not be found';
  end if;
  if user_role = 'admin' then
    raise exception 'Admin accounts do not use retailer invite codes';
  end if;

  update public.retailer_invite_codes
  set used_by = auth.uid(),
      used_at = clock_timestamp()
  where id = invite.id;

  update public.profiles
  set role = 'retailer'
  where id = auth.uid();

  insert into public.retailer_shops (user_id, shop_id)
  values (auth.uid(), invite.shop_id)
  on conflict (user_id, shop_id) do nothing;

  return invite.shop_id;
end;
$$;

create or replace function public.coconibz_admin_list_retailers()
returns table (
  user_id uuid,
  full_name text,
  phone text,
  created_at timestamptz,
  shop_names text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can view retailer accounts';
  end if;

  return query
    select
      profile.id,
      profile.full_name,
      profile.phone,
      profile.created_at,
      coalesce(
        array_agg(shop.name order by shop.name) filter (where shop.id is not null),
        array[]::text[]
      )
    from public.profiles as profile
    left join public.retailer_shops as assignment on assignment.user_id = profile.id
    left join public.shops as shop on shop.id = assignment.shop_id
    where profile.role = 'retailer'
    group by profile.id
    order by profile.full_name, profile.phone;
end;
$$;

create or replace function public.coconibz_admin_add_retailer(
  p_phone text,
  p_shop_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  retailer_user_id uuid;
  existing_role text;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can grant retailer access';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the retailer phone in international format';
  end if;
  if p_shop_id is null or not exists (
    select 1 from public.shops as shop where shop.id = p_shop_id
  ) then
    raise exception 'Choose a valid retailer shop';
  end if;

  select profile.id, profile.role
  into retailer_user_id, existing_role
  from public.profiles as profile
  where profile.phone = p_phone
  for update;
  if not found then
    raise exception 'The retailer must create and verify an account first';
  end if;
  if existing_role = 'admin' then
    raise exception 'An admin account cannot be changed to a retailer';
  end if;

  update public.profiles
  set role = 'retailer'
  where id = retailer_user_id;

  insert into public.retailer_shops (user_id, shop_id)
  values (retailer_user_id, p_shop_id)
  on conflict (user_id, shop_id) do nothing;
end;
$$;

create or replace function public.coconibz_admin_remove_retailer(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  retailer_role text;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can remove retailer access';
  end if;
  if p_user_id is null then
    raise exception 'Choose a retailer account';
  end if;

  select profile.role
  into retailer_role
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found or retailer_role <> 'retailer' then
    raise exception 'The selected account is not an active retailer';
  end if;

  delete from public.retailer_shops
  where user_id = p_user_id;

  update public.profiles
  set role = 'customer'
  where id = p_user_id;
end;
$$;

create or replace function public.coconibz_admin_revoke_retailer_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can revoke retailer invite codes';
  end if;
  if p_invite_id is null then
    raise exception 'Choose an invite code';
  end if;

  update public.retailer_invite_codes
  set revoked_by = auth.uid(),
      revoked_at = clock_timestamp()
  where id = p_invite_id
    and used_at is null
    and revoked_at is null;

  if not found then
    raise exception 'Invite code not found or already used or revoked';
  end if;
end;
$$;

revoke all on function public.coconibz_admin_create_retailer_invite(text) from public, anon;
revoke all on function public.coconibz_redeem_retailer_invite(text) from public, anon;
revoke all on function public.coconibz_admin_list_retailers() from public, anon;
revoke all on function public.coconibz_admin_add_retailer(text, text) from public, anon;
revoke all on function public.coconibz_admin_remove_retailer(uuid) from public, anon;
revoke all on function public.coconibz_admin_revoke_retailer_invite(uuid) from public, anon;
grant execute on function public.coconibz_admin_create_retailer_invite(text) to authenticated;
grant execute on function public.coconibz_redeem_retailer_invite(text) to authenticated;
grant execute on function public.coconibz_admin_list_retailers() to authenticated;
grant execute on function public.coconibz_admin_add_retailer(text, text) to authenticated;
grant execute on function public.coconibz_admin_remove_retailer(uuid) to authenticated;
grant execute on function public.coconibz_admin_revoke_retailer_invite(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'retailer_invite_codes'
     ) then
    alter publication supabase_realtime add table public.retailer_invite_codes;
  end if;
end;
$$;

commit;
