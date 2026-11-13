create table public.shop_product_prices (
  shop_id text not null references public.shops (id) on delete cascade,
  product_key text not null references public.coconibz_products (product_key) on delete cascade,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  currency char(3) not null default 'GHS',
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_key)
);

alter table public.shop_product_prices enable row level security;
revoke all on public.shop_product_prices from anon, authenticated;
grant select on public.shop_product_prices to authenticated;

create policy "Users view wholesale prices for assigned shops"
on public.shop_product_prices for select to authenticated
using ((select public.has_coconibz_shop_access(shop_id)));

insert into public.shop_product_prices (shop_id, product_key, unit_price)
select rates.shop_id, product.product_key, rates.unit_price
from (
  values
    ('uds-campus-mall', 12.00::numeric),
    ('dalims-multipurpose-shop', 12.00::numeric),
    ('fashion-scientist-couture', 12.00::numeric),
    ('nasara-hostel', 10.50::numeric),
    ('asawaba-goil-zonal-office', 12.00::numeric),
    ('ellizian-shop-legon-hostel', 11.00::numeric)
) as rates(shop_id, unit_price)
cross join public.coconibz_products as product
on conflict (shop_id, product_key) do update
set unit_price = excluded.unit_price,
    updated_at = now();

alter table public.stock_movements
  add column supply_unit_price numeric(10, 2)
    check (supply_unit_price is null or supply_unit_price >= 0);

alter table public.stock_movements
  add column supply_total numeric(12, 2)
    generated always as (
      case
        when supply_unit_price is null then null
        else quantity_change::numeric * supply_unit_price
      end
    ) stored;

create or replace function public.coconibz_set_stock_supply_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.movement_type = 'restock' then
    select coalesce(price.unit_price, product.unit_price::numeric(10, 2))
      into new.supply_unit_price
      from public.coconibz_products as product
      left join public.shop_product_prices as price
        on price.shop_id = new.shop_id
        and price.product_key = product.product_key
      where product.product_key = new.product_key;

    if not found then
      raise exception 'Could not determine the wholesale price for this product';
    end if;
  else
    new.supply_unit_price := null;
  end if;

  return new;
end;
$$;

create trigger coconibz_stock_movement_sets_supply_price
before insert on public.stock_movements
for each row execute function public.coconibz_set_stock_supply_price();
