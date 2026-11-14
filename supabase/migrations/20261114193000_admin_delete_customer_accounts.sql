alter table public.orders
  drop constraint if exists orders_customer_id_fkey;

alter table public.orders
  alter column customer_id drop not null,
  add constraint orders_customer_id_fkey
    foreign key (customer_id)
    references public.profiles (id)
    on delete set null;

create or replace function public.coconibz_anonymize_customer(p_customer_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_phone text;
  order_ids uuid[];
  feedback_ids uuid[];
  anonymized_orders integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'This operation is restricted to the customer deletion service.';
  end if;

  select profile.phone
    into customer_phone
    from public.profiles as profile
    where profile.id = p_customer_id
      and profile.role = 'customer';
  if not found then
    raise exception 'Customer account not found.';
  end if;

  if exists (
    select 1
    from public.orders as orders
    where orders.customer_id = p_customer_id
      and orders.status not in ('completed', 'cancelled')
  ) then
    raise exception 'Complete or cancel this customer''s active orders before deleting the account.';
  end if;

  select coalesce(array_agg(orders.id), array[]::uuid[])
    into order_ids
    from public.orders as orders
    where orders.customer_id = p_customer_id;

  select coalesce(array_agg(feedback.id), array[]::uuid[])
    into feedback_ids
    from public.customer_feedback as feedback
    where feedback.customer_id = p_customer_id
       or regexp_replace(coalesce(feedback.customer_phone, ''), '[^0-9]', '', 'g')
          = regexp_replace(customer_phone, '[^0-9]', '', 'g');

  update public.orders
    set customer_id = null,
        customer_name = 'Deleted customer',
        customer_phone = '',
        delivery_address = case
          when fulfillment = 'delivery' then 'Removed during account deletion'
          else null
        end
    where id = any(order_ids);
  get diagnostics anonymized_orders = row_count;

  delete from public.customer_feedback
    where id = any(feedback_ids);

  update public.coconibz_audit_logs
    set old_data = old_data - 'customer_id' - 'customer_name' - 'customer_phone' - 'delivery_address',
        new_data = new_data - 'customer_id' - 'customer_name' - 'customer_phone' - 'delivery_address'
    where table_name = 'orders'
      and record_id = any (select unnest(order_ids)::text);

  update public.coconibz_audit_logs
    set old_data = old_data - 'customer_id' - 'customer_name' - 'customer_phone' - 'comment',
        new_data = new_data - 'customer_id' - 'customer_name' - 'customer_phone' - 'comment'
    where table_name = 'customer_feedback'
      and record_id = any (select unnest(feedback_ids)::text);

  return anonymized_orders;
end;
$$;

revoke all on function public.coconibz_anonymize_customer(uuid) from public, anon, authenticated;
grant execute on function public.coconibz_anonymize_customer(uuid) to service_role;
