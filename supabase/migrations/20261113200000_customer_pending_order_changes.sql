create or replace function public.coconibz_customer_update_order(
  p_order_id uuid,
  p_shop_id text,
  p_fulfillment text,
  p_delivery_area text,
  p_delivery_address text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role text;
  current_status text;
  current_financial_status text;
  item jsonb;
  item_key text;
  item_quantity integer;
  item_flavor text;
  item_subtotal integer := 0;
  calculated_delivery_fee integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before editing an order.';
  end if;

  select profile.role
    into current_role
    from public.profiles as profile
    where profile.id = (select auth.uid());
  if current_role is distinct from 'customer' then
    raise exception 'Only customer accounts can edit customer orders.';
  end if;

  select orders.status, orders.financial_status
    into current_status, current_financial_status
    from public.orders
    where orders.id = p_order_id
      and orders.customer_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'Order not found for this customer.';
  end if;
  if current_status <> 'pending' then
    raise exception 'Only pending orders can be edited.';
  end if;
  if current_financial_status <> 'pending' or exists (
    select 1 from public.payments where payments.order_id = p_order_id
  ) then
    raise exception 'Payment activity must be resolved by COCONIBZ before this order can be changed.';
  end if;

  if p_fulfillment is null or p_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Choose pickup or delivery.';
  end if;

  if p_fulfillment = 'pickup' then
    if p_shop_id is null or not exists (
      select 1 from public.shops where id = p_shop_id
    ) then
      raise exception 'Choose a valid pickup shop.';
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Choose at least one flavor.';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 3 then
    raise exception 'Choose between one and three flavors.';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_key := item ->> 'product_key';
    item_flavor := case item_key
      when 'classic' then 'Coconut'
      when 'dates' then 'Coconut with Dates'
      when 'tigernut' then 'Coconut with Tigernuts'
      else null
    end;
    if item_flavor is null then
      raise exception 'An order contains an unknown flavor.';
    end if;

    if coalesce(item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'Order quantities must be whole numbers between 1 and 20.';
    end if;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 or item_quantity > 20 then
      raise exception 'Each flavor quantity must be between 1 and 20.';
    end if;

    if (
      select count(*)
      from jsonb_array_elements(p_items) as order_item(value)
      where order_item.value ->> 'product_key' = item_key
    ) > 1 then
      raise exception 'Each flavor can only appear once in an order.';
    end if;

    item_subtotal := item_subtotal + item_quantity * 12;
  end loop;

  update public.orders
    set shop_id = case when p_fulfillment = 'pickup' then p_shop_id else null end,
        fulfillment = p_fulfillment,
        delivery_area = case when p_fulfillment = 'delivery' then p_delivery_area else null end,
        delivery_address = case when p_fulfillment = 'delivery' then trim(p_delivery_address) else null end,
        subtotal = item_subtotal,
        delivery_fee = calculated_delivery_fee,
        total = item_subtotal + calculated_delivery_fee
    where id = p_order_id;

  delete from public.order_items where order_id = p_order_id;
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
    values (p_order_id, item_key, item_flavor, item_quantity, 12);
  end loop;
end;
$$;

create or replace function public.coconibz_customer_cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role text;
  current_status text;
  current_financial_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before cancelling an order.';
  end if;

  select profile.role
    into current_role
    from public.profiles as profile
    where profile.id = (select auth.uid());
  if current_role is distinct from 'customer' then
    raise exception 'Only customer accounts can cancel customer orders.';
  end if;

  select orders.status, orders.financial_status
    into current_status, current_financial_status
    from public.orders
    where orders.id = p_order_id
      and orders.customer_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'Order not found for this customer.';
  end if;
  if current_status <> 'pending' then
    raise exception 'Only pending orders can be cancelled.';
  end if;
  if current_financial_status <> 'pending' or exists (
    select 1 from public.payments where payments.order_id = p_order_id
  ) then
    raise exception 'Payment activity must be resolved by COCONIBZ before this order can be changed.';
  end if;

  update public.orders
    set status = 'cancelled'
    where id = p_order_id;
end;
$$;

revoke all on function public.coconibz_customer_update_order(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.coconibz_customer_cancel_order(uuid) from public, anon;
grant execute on function public.coconibz_customer_update_order(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.coconibz_customer_cancel_order(uuid) to authenticated;
