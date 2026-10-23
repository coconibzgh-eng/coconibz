create table public.shops (
  id text primary key,
  name text not null,
  whatsapp_number text,
  created_at timestamptz not null default now()
);

insert into public.shops (id, name, whatsapp_number) values
  ('uds-campus-mall', 'UDS Campus Mall', null),
  ('dalims-multipurpose-shop', 'Dalims Multipurpose Shop', '233241637249'),
  ('fashion-scientist-couture', 'Fashion Scientist Couture', '233549587229'),
  ('nasara-hostel', 'Nasara Hostel', '233241855696'),
  ('asawaba-goil-zonal-office', 'Asawaba, GOIL Zonal Office', '233246344188'),
  ('ellizian-shop-legon-hostel', 'Ellizian Shop (Legon Hostel)', '233244330356')
on conflict (id) do update set
  name = excluded.name,
  whatsapp_number = excluded.whatsapp_number;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text not null,
  role text not null default 'customer'
    check (role in ('customer', 'admin', 'retailer')),
  created_at timestamptz not null default now()
);

create table public.retailer_shops (
  user_id uuid not null references public.profiles (id) on delete cascade,
  shop_id text not null references public.shops (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  customer_name text not null,
  customer_phone text not null,
  shop_id text references public.shops (id),
  fulfillment text not null check (fulfillment in ('pickup', 'delivery')),
  delivery_area text,
  delivery_address text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
  subtotal integer not null check (subtotal >= 0),
  delivery_fee integer not null default 0 check (delivery_fee >= 0),
  total integer not null check (total = subtotal + delivery_fee),
  created_at timestamptz not null default now(),
  check (
    (fulfillment = 'pickup' and shop_id is not null and delivery_area is null and delivery_address is null and delivery_fee = 0)
    or
    (fulfillment = 'delivery' and shop_id is null and delivery_area is not null and delivery_address is not null)
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_key text not null check (product_key in ('classic', 'dates', 'tigernut')),
  flavor text not null,
  quantity integer not null check (quantity between 1 and 20),
  unit_price integer not null check (unit_price = 12),
  line_total integer generated always as (quantity * unit_price) stored
);

create index orders_customer_created_idx on public.orders (customer_id, created_at desc);
create index orders_shop_created_idx on public.orders (shop_id, created_at desc);
create index orders_status_created_idx on public.orders (status, created_at desc);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_flavor_idx on public.order_items (product_key);

create function public.handle_new_coconibz_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.phone, '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created_coconibz
  after insert on auth.users
  for each row execute function public.handle_new_coconibz_user();

create function public.is_coconibz_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create function public.has_coconibz_shop_access(target_shop_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_coconibz_admin()
    or exists (
      select 1 from public.retailer_shops
      where user_id = (select auth.uid()) and shop_id = target_shop_id
    );
$$;

revoke all on function public.is_coconibz_admin() from public, anon;
revoke all on function public.has_coconibz_shop_access(text) from public, anon;
grant execute on function public.is_coconibz_admin() to authenticated;
grant execute on function public.has_coconibz_shop_access(text) to authenticated;

create function public.place_coconibz_order(
  p_shop_id text,
  p_fulfillment text,
  p_delivery_area text,
  p_delivery_address text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_order_id uuid;
  item jsonb;
  item_key text;
  item_quantity integer;
  item_flavor text;
  item_subtotal integer := 0;
  calculated_delivery_fee integer := 0;
  order_customer_name text;
  order_customer_phone text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before placing an order.';
  end if;

  if p_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Choose pickup or delivery.';
  end if;

  select full_name, phone
    into order_customer_name, order_customer_phone
    from public.profiles
    where id = (select auth.uid());
  if not found then
    raise exception 'Your customer profile could not be found.';
  end if;

  if p_fulfillment = 'pickup' then
    if p_shop_id is null or not exists (
      select 1 from public.shops where id = p_shop_id
    ) then
      raise exception 'The selected pickup shop is not valid.';
    end if;
    if p_delivery_area is not null or p_delivery_address is not null then
      raise exception 'Pickup orders cannot include delivery details.';
    end if;
  else
    if p_shop_id is not null or nullif(trim(p_delivery_address), '') is null then
      raise exception 'Enter a delivery address and do not select a pickup shop.';
    end if;
    calculated_delivery_fee := case p_delivery_area
      when 'Campus' then 5
      when 'Town/off campus' then 10
      else -1
    end;
    if calculated_delivery_fee < 0 then
      raise exception 'Choose a valid delivery area.';
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 3 then
    raise exception 'Choose between one and three flavors.';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_key := item ->> 'product_key';
    if item_key = 'classic' then
      item_flavor := 'Coconut';
    elsif item_key = 'dates' then
      item_flavor := 'Coconut with Dates';
    elsif item_key = 'tigernut' then
      item_flavor := 'Coconut with Tigernuts';
    else
      raise exception 'An order contains an unknown flavor.';
    end if;

    if coalesce(item ->> 'quantity', '') !~ '^[0-9]+$' then
      raise exception 'Order quantities must be whole numbers.';
    end if;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 or item_quantity > 20 then
      raise exception 'Each flavor quantity must be between 1 and 20.';
    end if;

    if (
      select count(*) from jsonb_array_elements(p_items) as order_item(value)
      where value ->> 'product_key' = item_key
    ) > 1 then
      raise exception 'Each flavor can only appear once in an order.';
    end if;

    item_subtotal := item_subtotal + item_quantity * 12;
  end loop;

  insert into public.orders (
    customer_id, customer_name, customer_phone, shop_id, fulfillment, delivery_area, delivery_address,
    subtotal, delivery_fee, total
  )
  values (
    (select auth.uid()),
    order_customer_name,
    order_customer_phone,
    p_shop_id,
    p_fulfillment,
    case when p_fulfillment = 'delivery' then p_delivery_area else null end,
    case when p_fulfillment = 'delivery' then trim(p_delivery_address) else null end,
    item_subtotal,
    calculated_delivery_fee,
    item_subtotal + calculated_delivery_fee
  )
  returning id into new_order_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_key := item ->> 'product_key';
    item_quantity := (item ->> 'quantity')::integer;
    item_flavor := case item_key
      when 'classic' then 'Coconut'
      when 'dates' then 'Coconut with Dates'
      when 'tigernut' then 'Coconut with Tigernuts'
    end;
    insert into public.order_items (order_id, product_key, flavor, quantity, unit_price)
    values (new_order_id, item_key, item_flavor, item_quantity, 12);
  end loop;

  return new_order_id;
end;
$$;

revoke all on function public.place_coconibz_order(text, text, text, text, jsonb) from public, anon;
grant execute on function public.place_coconibz_order(text, text, text, text, jsonb) to authenticated;

create function public.coconibz_sales_summary(
  p_start_date date default null,
  p_end_date date default null
)
returns table (
  shop_id text,
  shop_name text,
  completed_orders bigint,
  sales_total bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_coconibz_admin() then
    raise exception 'Only an admin can view the all-shop financial summary.';
  end if;

  return query
    select
      shops.id,
      shops.name,
      count(orders.id),
      coalesce(sum(orders.total), 0)::bigint
    from public.shops
    left join public.orders
      on orders.shop_id = shops.id
      and orders.status = 'completed'
      and (p_start_date is null or orders.created_at >= p_start_date::timestamp with time zone)
      and (p_end_date is null or orders.created_at < (p_end_date + 1)::timestamp with time zone)
    group by shops.id, shops.name
    union all
    select
      null::text,
      'Unassigned delivery',
      count(orders.id),
      coalesce(sum(orders.total), 0)::bigint
    from public.orders
    where orders.shop_id is null
      and orders.status = 'completed'
      and (p_start_date is null or orders.created_at >= p_start_date::timestamp with time zone)
      and (p_end_date is null or orders.created_at < (p_end_date + 1)::timestamp with time zone);
end;
$$;

revoke all on function public.coconibz_sales_summary(date, date) from public, anon;
grant execute on function public.coconibz_sales_summary(date, date) to authenticated;

create function public.admin_set_retailer_access(
  p_phone text,
  p_shop_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  retailer_user_id uuid;
begin
  if not public.is_coconibz_admin() then
    raise exception 'Only an admin can assign retailer access.';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the retailer phone in international format.';
  end if;
  if p_shop_ids is null or cardinality(p_shop_ids) < 1 then
    raise exception 'Assign the retailer to at least one shop.';
  end if;
  if exists (
    select 1 from unnest(p_shop_ids) as requested(shop_id)
    where not exists (select 1 from public.shops where id = requested.shop_id)
  ) then
    raise exception 'One or more selected shops are invalid.';
  end if;

  select id into retailer_user_id
    from public.profiles
    where phone = p_phone;
  if retailer_user_id is null then
    raise exception 'The retailer must create and verify an account before being assigned.';
  end if;
  if exists (
    select 1 from public.profiles
    where id = retailer_user_id and role = 'admin'
  ) then
    raise exception 'An admin account cannot be downgraded to a retailer.';
  end if;

  update public.profiles set role = 'retailer' where id = retailer_user_id;
  delete from public.retailer_shops where user_id = retailer_user_id;
  insert into public.retailer_shops (user_id, shop_id)
    select retailer_user_id, requested.shop_id
    from (select distinct unnest(p_shop_ids) as shop_id) as requested;
end;
$$;

create function public.admin_remove_retailer_access(p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  retailer_user_id uuid;
begin
  if not public.is_coconibz_admin() then
    raise exception 'Only an admin can remove retailer access.';
  end if;

  select id into retailer_user_id
    from public.profiles
    where phone = p_phone and role = 'retailer';
  if retailer_user_id is null then
    raise exception 'No retailer account was found for that phone number.';
  end if;

  delete from public.retailer_shops where user_id = retailer_user_id;
  update public.profiles set role = 'customer' where id = retailer_user_id;
end;
$$;

revoke all on function public.admin_set_retailer_access(text, text[]) from public, anon;
revoke all on function public.admin_remove_retailer_access(text) from public, anon;
grant execute on function public.admin_set_retailer_access(text, text[]) to authenticated;
grant execute on function public.admin_remove_retailer_access(text) to authenticated;

alter table public.shops enable row level security;
alter table public.profiles enable row level security;
alter table public.retailer_shops enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.shops, public.profiles, public.retailer_shops, public.orders, public.order_items from anon, authenticated;
grant select on public.shops to anon, authenticated;
grant select on public.profiles, public.retailer_shops, public.orders, public.order_items to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (status) on public.orders to authenticated;

create policy "shops are publicly readable"
  on public.shops for select
  to anon, authenticated
  using (true);

create policy "users read their profile and admins read all profiles"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_coconibz_admin()));

create policy "users update their own name"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "retailers read their shop assignments and admins read all"
  on public.retailer_shops for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_coconibz_admin()));

create policy "customers and assigned staff read orders"
  on public.orders for select
  to authenticated
  using (
    customer_id = (select auth.uid())
    or (select public.has_coconibz_shop_access(shop_id))
  );

create policy "admins and assigned retailers update order status"
  on public.orders for update
  to authenticated
  using ((select public.has_coconibz_shop_access(shop_id)))
  with check ((select public.has_coconibz_shop_access(shop_id)));

create policy "customers and assigned staff read order items"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (
          orders.customer_id = (select auth.uid())
          or (select public.has_coconibz_shop_access(orders.shop_id))
        )
    )
  );
