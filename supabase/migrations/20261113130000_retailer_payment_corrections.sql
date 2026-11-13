begin;

drop trigger if exists coconibz_audit_retailer_payments
on public.retailer_payments;

create trigger coconibz_audit_retailer_payments
after insert or update or delete on public.retailer_payments
for each row execute function public.coconibz_record_audit_log();

create or replace function public.coconibz_update_retailer_payment(
  p_payment_id uuid,
  p_shop_id text,
  p_amount numeric,
  p_paid_at date,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can edit retailer payments';
  end if;
  if p_payment_id is null then
    raise exception 'Choose a valid payment';
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

  update public.retailer_payments
  set shop_id = p_shop_id,
      amount = p_amount,
      paid_at = p_paid_at,
      note = nullif(trim(p_note), '')
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found';
  end if;
end;
$$;

create or replace function public.coconibz_delete_retailer_payment(
  p_payment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can delete retailer payments';
  end if;
  if p_payment_id is null then
    raise exception 'Choose a valid payment';
  end if;

  delete from public.retailer_payments
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found';
  end if;
end;
$$;

revoke all on function public.coconibz_update_retailer_payment(uuid, text, numeric, date, text) from public, anon;
revoke all on function public.coconibz_delete_retailer_payment(uuid) from public, anon;
grant execute on function public.coconibz_update_retailer_payment(uuid, text, numeric, date, text) to authenticated;
grant execute on function public.coconibz_delete_retailer_payment(uuid) to authenticated;

commit;
