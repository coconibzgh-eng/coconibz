alter table public.profiles
  add column if not exists sms_marketing_opt_in boolean not null default false;

grant update (sms_marketing_opt_in) on public.profiles to authenticated;

create table public.coconibz_order_sms_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  notification_type text not null check (
    notification_type in ('order_confirmation', 'order_status', 'payment_update')
  ),
  event_key text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  requested_by uuid not null references auth.users (id) on delete cascade,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, notification_type, event_key)
);

alter table public.coconibz_order_sms_log enable row level security;
revoke all on public.coconibz_order_sms_log from anon, authenticated;
grant select on public.coconibz_order_sms_log to authenticated;

create policy "Admins can view order SMS delivery records"
  on public.coconibz_order_sms_log for select
  to authenticated
  using ((select public.is_coconibz_admin()));

create or replace function public.coconibz_claim_order_sms(
  p_order_id uuid,
  p_notification_type text,
  p_event_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_record public.orders%rowtype;
  caller_role text;
  notification_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before sending an order SMS.';
  end if;

  select profile.role
    into caller_role
    from public.profiles as profile
    where profile.id = auth.uid();

  select orders.*
    into order_record
    from public.orders as orders
    where orders.id = p_order_id;
  if not found then
    raise exception 'Order not found.';
  end if;

  if p_notification_type = 'order_confirmation' then
    if order_record.customer_id <> auth.uid()
       or order_record.status <> 'pending'
       or p_event_key <> order_record.id::text then
      raise exception 'You cannot send a confirmation for this order.';
    end if;
  elsif p_notification_type = 'order_status' then
    if caller_role is null
       or caller_role not in ('admin', 'retailer')
       or not public.has_coconibz_shop_access(order_record.shop_id)
       or p_event_key <> order_record.status then
      raise exception 'You cannot send a status update for this order.';
    end if;
  elsif p_notification_type = 'payment_update' then
    if caller_role is null
       or caller_role <> 'admin'
       or p_event_key <> order_record.financial_status then
      raise exception 'You cannot send a payment update for this order.';
    end if;
  else
    raise exception 'Unsupported order SMS type.';
  end if;

  insert into public.coconibz_order_sms_log as sms_log (
    order_id, notification_type, event_key, requested_by
  )
  values (
    order_record.id, p_notification_type, p_event_key, auth.uid()
  )
  on conflict (order_id, notification_type, event_key)
  do update
    set status = 'sending',
        requested_by = auth.uid(),
        provider_message_id = null,
        updated_at = now()
    where sms_log.status = 'failed'
  returning id into notification_id;

  return notification_id;
end;
$$;

create or replace function public.coconibz_finish_order_sms(
  p_notification_id uuid,
  p_status text,
  p_provider_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or p_status not in ('sent', 'failed')
     or length(coalesce(p_provider_message_id, '')) > 200 then
    raise exception 'Invalid order SMS delivery update.';
  end if;

  update public.coconibz_order_sms_log
    set status = p_status,
        provider_message_id = p_provider_message_id,
        updated_at = now()
    where id = p_notification_id
      and requested_by = auth.uid()
      and status = 'sending';

  if not found then
    raise exception 'The order SMS delivery record could not be updated.';
  end if;
end;
$$;

revoke all on function public.coconibz_claim_order_sms(uuid, text, text) from public, anon;
revoke all on function public.coconibz_finish_order_sms(uuid, text, text) from public, anon;
grant execute on function public.coconibz_claim_order_sms(uuid, text, text) to authenticated;
grant execute on function public.coconibz_finish_order_sms(uuid, text, text) to authenticated;
