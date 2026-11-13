begin;

create table public.retailer_finance_accounts (
  shop_id text primary key references public.shops (id) on delete restrict,
  opening_units bigint not null check (opening_units >= 0),
  opening_balance numeric(12, 2) not null check (opening_balance >= 0),
  opened_at timestamptz not null
);

lock table public.stock_movements, public.shop_inventory in share mode;

with opening_snapshot as (
  select clock_timestamp() as opened_at
)
insert into public.retailer_finance_accounts (
  shop_id, opening_units, opening_balance, opened_at
)
select
  shop.id,
  coalesce(sum(inventory.quantity_on_hand), 0)::bigint,
  coalesce(
    sum(inventory.quantity_on_hand * coalesce(price.unit_price, product.unit_price::numeric)),
    0
  )::numeric(12, 2),
  opening_snapshot.opened_at
from public.shops as shop
cross join opening_snapshot
left join public.shop_inventory as inventory on inventory.shop_id = shop.id
left join public.coconibz_products as product on product.product_key = inventory.product_key
left join public.shop_product_prices as price
  on price.shop_id = inventory.shop_id
  and price.product_key = inventory.product_key
group by shop.id, opening_snapshot.opened_at;

create table public.retailer_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at date not null default current_date,
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index retailer_payments_shop_date_idx
  on public.retailer_payments (shop_id, paid_at desc, created_at desc);

alter table public.retailer_finance_accounts enable row level security;
alter table public.retailer_payments enable row level security;
revoke all on public.retailer_finance_accounts, public.retailer_payments from anon, authenticated;
grant select on public.retailer_payments to authenticated;

create policy "Admins view retailer payments"
on public.retailer_payments for select to authenticated
using ((select public.is_coconibz_admin()));

create trigger coconibz_audit_retailer_payments
after insert on public.retailer_payments
for each row execute function public.coconibz_record_audit_log();

create or replace function public.coconibz_retailer_finance_summary()
returns table (
  shop_id text,
  opening_units bigint,
  opening_balance numeric,
  supplied_units bigint,
  supply_value numeric,
  total_due numeric,
  total_paid numeric,
  balance_due numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can view retailer finance balances';
  end if;

  return query
    select
      shop.id,
      coalesce(account.opening_units, 0)::bigint,
      coalesce(account.opening_balance, 0::numeric),
      coalesce(supply.units, 0)::bigint,
      coalesce(supply.supply_value, 0::numeric),
      coalesce(account.opening_balance, 0::numeric) + coalesce(supply.supply_value, 0::numeric),
      coalesce(paid.amount, 0::numeric),
      coalesce(account.opening_balance, 0::numeric)
        + coalesce(supply.supply_value, 0::numeric)
        - coalesce(paid.amount, 0::numeric)
    from public.shops as shop
    left join public.retailer_finance_accounts as account on account.shop_id = shop.id
    left join lateral (
      select
        sum(movement.quantity_change)::bigint as units,
        sum(movement.supply_total) as supply_value
      from public.stock_movements as movement
      where movement.shop_id = shop.id
        and movement.movement_type = 'restock'
        and movement.supply_total is not null
        and movement.created_at > account.opened_at
    ) as supply on true
    left join lateral (
      select sum(payment.amount) as amount
      from public.retailer_payments as payment
      where payment.shop_id = shop.id
    ) as paid on true
    order by shop.name;
end;
$$;

create or replace function public.coconibz_record_retailer_payment(
  p_shop_id text,
  p_amount numeric,
  p_paid_at date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_id uuid;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can record retailer payments';
  end if;
  if p_shop_id is null or not exists (
    select 1 from public.shops as shop where shop.id = p_shop_id
  ) then
    raise exception 'Choose a valid retailer';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount must be positive and have no more than two decimal places';
  end if;
  if p_paid_at is null then
    raise exception 'Choose the payment date';
  end if;

  insert into public.retailer_payments (shop_id, amount, paid_at, note, recorded_by)
  values (
    p_shop_id,
    p_amount,
    p_paid_at,
    nullif(trim(p_note), ''),
    auth.uid()
  )
  returning id into payment_id;

  return payment_id;
end;
$$;

revoke all on function public.coconibz_retailer_finance_summary() from public, anon;
revoke all on function public.coconibz_record_retailer_payment(text, numeric, date, text) from public, anon;
grant execute on function public.coconibz_retailer_finance_summary() to authenticated;
grant execute on function public.coconibz_record_retailer_payment(text, numeric, date, text) to authenticated;

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
    new.created_at := clock_timestamp();
  else
    new.supply_unit_price := null;
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'retailer_payments'
     ) then
    alter publication supabase_realtime add table public.retailer_payments;
  end if;
end;
$$;

commit;
