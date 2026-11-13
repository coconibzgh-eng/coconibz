update public.shops
set
  address = case id
    when 'nasara-hostel' then '9.412126, -0.863540'
    when 'ellizian-shop-legon-hostel' then 'Legon Hostel'
    else address
  end,
  map_url = case
    when id = 'nasara-hostel' and map_url is null
      then 'https://www.google.com/maps/search/?api=1&query=9.412126%2C-0.863540'
    else map_url
  end,
  opening_hours = coalesce(opening_hours, 'Hours to be confirmed')
where id in (
  'uds-campus-mall',
  'dalims-multipurpose-shop',
  'fashion-scientist-couture',
  'nasara-hostel',
  'asawaba-goil-zonal-office',
  'ellizian-shop-legon-hostel'
);

drop trigger if exists coconibz_audit_shops on public.shops;

create trigger coconibz_audit_shops
after insert or update on public.shops
for each row execute function public.coconibz_record_audit_log();

create or replace function public.coconibz_admin_update_shop_name(
  p_shop_id text,
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  current_name text;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can edit shop names';
  end if;

  if p_shop_id is null then
    raise exception 'Choose a valid shop';
  end if;

  normalized_name := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(normalized_name) < 2 or length(normalized_name) > 120 then
    raise exception 'Shop name must be between 2 and 120 characters';
  end if;

  select shop.name
    into current_name
    from public.shops as shop
    where shop.id = p_shop_id
    for update;
  if not found then
    raise exception 'Shop not found';
  end if;

  if current_name = normalized_name then
    return current_name;
  end if;

  if exists (
    select 1
    from public.shops as shop
    where shop.id <> p_shop_id
      and lower(shop.name) = lower(normalized_name)
  ) then
    raise exception 'A shop with this name already exists';
  end if;

  update public.shops
    set name = normalized_name
    where id = p_shop_id;

  return normalized_name;
end;
$$;

revoke all on function public.coconibz_admin_update_shop_name(text, text) from public, anon;
grant execute on function public.coconibz_admin_update_shop_name(text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'shops'
     ) then
    alter publication supabase_realtime add table public.shops;
  end if;
end;
$$;

notify pgrst, 'reload schema';
