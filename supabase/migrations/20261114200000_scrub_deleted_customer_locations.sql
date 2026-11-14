create or replace function public.coconibz_scrub_deleted_customer_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.customer_id is not null and new.customer_id is null then
    new.delivery_area := null;
    new.delivery_address := null;
  end if;
  return new;
end;
$$;

create trigger coconibz_scrub_deleted_customer_location
before update of customer_id on public.orders
for each row
execute function public.coconibz_scrub_deleted_customer_location();

update public.coconibz_audit_logs as audit
set old_data = audit.old_data - 'delivery_area' - 'delivery_address',
    new_data = audit.new_data - 'delivery_area' - 'delivery_address'
where audit.table_name = 'orders'
  and exists (
    select 1
    from public.orders as orders
    where orders.id::text = audit.record_id
      and orders.customer_id is null
  );
