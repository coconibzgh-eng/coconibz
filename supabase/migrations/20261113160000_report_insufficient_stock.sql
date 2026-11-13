create or replace function public.coconibz_apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_quantity integer;
  resulting_quantity bigint;
  product_name text;
begin
  insert into public.shop_inventory (shop_id, product_key, quantity_on_hand)
  values (new.shop_id, new.product_key, 0)
  on conflict (shop_id, product_key) do nothing;

  select inventory.quantity_on_hand
    into current_quantity
    from public.shop_inventory as inventory
    where inventory.shop_id = new.shop_id
      and inventory.product_key = new.product_key
    for update;

  resulting_quantity := current_quantity::bigint + new.quantity_change::bigint;
  select product.name
    into product_name
    from public.coconibz_products as product
    where product.product_key = new.product_key;

  if resulting_quantity < 0 then
    raise exception 'Insufficient stock for %: % available, % requested',
      coalesce(product_name, new.product_key),
      current_quantity,
      -(new.quantity_change::bigint);
  end if;

  if resulting_quantity > 2147483647 then
    raise exception 'Stock quantity exceeds the supported limit for %',
      coalesce(product_name, new.product_key);
  end if;

  update public.shop_inventory
    set quantity_on_hand = resulting_quantity::integer,
        updated_at = now()
    where shop_id = new.shop_id
      and product_key = new.product_key;

  return new;
end;
$$;

notify pgrst, 'reload schema';
