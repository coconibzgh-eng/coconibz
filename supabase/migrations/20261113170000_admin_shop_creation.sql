alter table public.shops
  add column address text,
  add column map_url text,
  add column opening_hours text;

create trigger coconibz_audit_shops
after insert on public.shops
for each row execute function public.coconibz_record_audit_log();

create or replace function public.coconibz_admin_create_shop(
  p_name text,
  p_address text,
  p_whatsapp_number text default null,
  p_map_url text default null,
  p_opening_hours text default null,
  p_wholesale_price numeric default 12.00
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text;
  normalized_address text;
  normalized_whatsapp text;
  normalized_map_url text;
  normalized_opening_hours text;
  base_id text;
  new_shop_id text;
  suffix integer := 1;
  suffix_text text;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can create shops';
  end if;

  normalized_name := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(normalized_name) < 2 or length(normalized_name) > 120 then
    raise exception 'Shop name must be between 2 and 120 characters';
  end if;
  if exists (
    select 1
    from public.shops as shop
    where lower(shop.name) = lower(normalized_name)
  ) then
    raise exception 'A shop with this name already exists';
  end if;

  normalized_address := nullif(trim(p_address), '');
  if normalized_address is null or length(normalized_address) > 240 then
    raise exception 'Enter a shop address or location (maximum 240 characters)';
  end if;

  normalized_whatsapp := nullif(regexp_replace(coalesce(p_whatsapp_number, ''), '[^0-9]', '', 'g'), '');
  if normalized_whatsapp is not null and length(normalized_whatsapp) not between 8 and 15 then
    raise exception 'WhatsApp number must contain 8 to 15 digits';
  end if;

  normalized_map_url := nullif(trim(p_map_url), '');
  if normalized_map_url is not null and normalized_map_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Map link must be a valid HTTPS URL';
  end if;

  normalized_opening_hours := nullif(trim(p_opening_hours), '');
  if normalized_opening_hours is not null and length(normalized_opening_hours) > 120 then
    raise exception 'Opening hours must not exceed 120 characters';
  end if;

  if p_wholesale_price is null
     or p_wholesale_price <= 0
     or p_wholesale_price <> round(p_wholesale_price, 2) then
    raise exception 'Wholesale price must be greater than zero with no more than two decimal places';
  end if;

  base_id := trim(both '-' from regexp_replace(lower(normalized_name), '[^a-z0-9]+', '-', 'g'));
  if base_id = '' then
    raise exception 'Shop name must include at least one letter or number';
  end if;
  base_id := left(base_id, 80);
  new_shop_id := base_id;

  while exists (select 1 from public.shops where id = new_shop_id)
  loop
    suffix := suffix + 1;
    suffix_text := '-' || suffix::text;
    new_shop_id := left(base_id, 80 - length(suffix_text)) || suffix_text;
  end loop;

  insert into public.shops (
    id, name, whatsapp_number, address, map_url, opening_hours
  )
  values (
    new_shop_id,
    normalized_name,
    normalized_whatsapp,
    normalized_address,
    normalized_map_url,
    normalized_opening_hours
  );

  insert into public.shop_inventory (shop_id, product_key, quantity_on_hand)
  select new_shop_id, product.product_key, 0
  from public.coconibz_products as product;

  insert into public.shop_product_prices (shop_id, product_key, unit_price)
  select new_shop_id, product.product_key, p_wholesale_price
  from public.coconibz_products as product;

  insert into public.retailer_finance_accounts (
    shop_id, opening_units, opening_balance, opened_at
  )
  values (new_shop_id, 0, 0, clock_timestamp());

  return new_shop_id;
end;
$$;

revoke all on function public.coconibz_admin_create_shop(text, text, text, text, text, numeric) from public, anon;
grant execute on function public.coconibz_admin_create_shop(text, text, text, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
