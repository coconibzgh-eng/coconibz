create or replace function public.coconibz_stock_supply_summary()
returns table (
  shop_id text,
  units_supplied bigint,
  last_supplied_at timestamptz,
  last_activity_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    shop.id,
    coalesce(
      sum(movement.quantity_change) filter (
        where movement.movement_type in ('restock', 'transfer_in')
      ),
      0
    )::bigint,
    max(movement.created_at) filter (
      where movement.movement_type in ('restock', 'transfer_in')
    ),
    max(movement.created_at)
  from public.shops as shop
  left join public.stock_movements as movement on movement.shop_id = shop.id
  where public.has_coconibz_shop_access(shop.id)
  group by shop.id;
$$;

revoke all on function public.coconibz_stock_supply_summary() from public, anon;
grant execute on function public.coconibz_stock_supply_summary() to authenticated;
