create policy "Retailers can view payments for assigned shops"
on public.retailer_payments
for select
to authenticated
using (
  exists (
    select 1
    from public.retailer_shops as assignment
    where assignment.user_id = auth.uid()
      and assignment.shop_id = retailer_payments.shop_id
  )
);

create or replace function public.coconibz_retailer_own_finance_summary()
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
  if auth.uid() is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and profile.role = 'retailer'
  ) then
    raise exception 'Only a retailer can view assigned-shop finance balances';
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
    join public.retailer_shops as assignment
      on assignment.shop_id = shop.id
     and assignment.user_id = auth.uid()
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

revoke all on function public.coconibz_retailer_own_finance_summary() from public, anon;
grant execute on function public.coconibz_retailer_own_finance_summary() to authenticated;

notify pgrst, 'reload schema';
