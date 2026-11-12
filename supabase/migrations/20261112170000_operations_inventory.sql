create table public.coconibz_products (
  product_key text primary key
    check (product_key in ('classic', 'dates', 'tigernut')),
  name text not null,
  unit_price integer not null check (unit_price >= 0),
  currency char(3) not null default 'GHS',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.coconibz_products (product_key, name, unit_price) values
  ('classic', 'Coconut', 12),
  ('dates', 'Coconut with Dates', 12),
  ('tigernut', 'Coconut with Tigernuts', 12)
on conflict (product_key) do nothing;

create table public.shop_inventory (
  shop_id text not null references public.shops (id) on delete restrict,
  product_key text not null references public.coconibz_products (product_key) on delete restrict,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_key)
);

insert into public.shop_inventory (shop_id, product_key, quantity_on_hand)
select shops.id, products.product_key, 0
from public.shops
cross join public.coconibz_products as products
on conflict (shop_id, product_key) do nothing;

create table public.retailer_sales (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops (id) on delete restrict,
  total_amount integer not null default 0 check (total_amount >= 0),
  currency char(3) not null default 'GHS',
  payment_method text check (payment_method in ('cash', 'mobile_money', 'other')),
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index retailer_sales_shop_sold_idx on public.retailer_sales (shop_id, sold_at desc);

create table public.retailer_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.retailer_sales (id) on delete restrict,
  product_key text not null references public.coconibz_products (product_key) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  line_total integer generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create index retailer_sale_items_sale_idx on public.retailer_sale_items (sale_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops (id) on delete restrict,
  product_key text not null references public.coconibz_products (product_key) on delete restrict,
  movement_type text not null
    check (movement_type in ('restock', 'sale', 'adjustment', 'transfer_in', 'transfer_out', 'order_fulfillment')),
  quantity_change integer not null check (quantity_change <> 0),
  order_id uuid references public.orders (id) on delete set null,
  sale_id uuid references public.retailer_sales (id) on delete set null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stock_movement_direction check (
    (movement_type in ('restock', 'transfer_in') and quantity_change > 0)
    or (movement_type in ('sale', 'transfer_out', 'order_fulfillment') and quantity_change < 0)
    or movement_type = 'adjustment'
  )
);

create index stock_movements_shop_created_idx on public.stock_movements (shop_id, created_at desc);
create index stock_movements_product_created_idx on public.stock_movements (product_key, created_at desc);

alter table public.orders
  add column if not exists financial_status text not null default 'pending'
    check (financial_status in ('pending', 'paid', 'failed', 'refunded')),
  add column if not exists payment_method text
    check (payment_method in ('cash', 'mobile_money', 'other'));

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  method text not null check (method in ('cash', 'mobile_money', 'other')),
  provider text,
  provider_reference text,
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  amount integer not null check (amount >= 0),
  currency char(3) not null default 'GHS',
  paid_at timestamptz,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint coconibz_payment_provider_reference_unique unique (provider, provider_reference)
);

create index payments_order_created_idx on public.payments (order_id, created_at desc);

create table public.customer_feedback (
  id uuid primary key default gen_random_uuid(),
  shop_id text references public.shops (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  customer_id uuid references public.profiles (id) on delete set null,
  customer_name text,
  customer_phone text,
  rating smallint check (rating between 1 and 5),
  comment text not null,
  source text not null default 'other'
    check (source in ('website', 'whatsapp', 'phone', 'in_person', 'other')),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index customer_feedback_shop_created_idx on public.customer_feedback (shop_id, created_at desc);

create table public.coconibz_audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  actor_id uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index coconibz_audit_logs_occurred_idx on public.coconibz_audit_logs (occurred_at desc);
create index coconibz_audit_logs_record_idx on public.coconibz_audit_logs (table_name, record_id);

create or replace function public.coconibz_apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_quantity integer;
begin
  insert into public.shop_inventory (shop_id, product_key, quantity_on_hand)
  values (new.shop_id, new.product_key, new.quantity_change)
  on conflict (shop_id, product_key)
  do update
    set quantity_on_hand = public.shop_inventory.quantity_on_hand + excluded.quantity_on_hand,
        updated_at = now()
  returning quantity_on_hand into updated_quantity;

  if updated_quantity < 0 then
    raise exception 'This movement would make shop stock negative';
  end if;

  return new;
end;
$$;

create or replace function public.coconibz_record_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_record jsonb;
  new_record jsonb;
  row_data jsonb;
begin
  if tg_op = 'INSERT' then
    new_record := to_jsonb(new);
    row_data := new_record;
  elsif tg_op = 'UPDATE' then
    old_record := to_jsonb(old);
    new_record := to_jsonb(new);
    row_data := new_record;
  else
    old_record := to_jsonb(old);
    row_data := old_record;
  end if;

  insert into public.coconibz_audit_logs (
    table_name, record_id, action, old_data, new_data, actor_id
  )
  values (
    tg_table_name,
    coalesce(
      row_data ->> 'id',
      row_data ->> 'order_number',
      nullif(concat_ws(
        ':',
        row_data ->> 'shop_id',
        coalesce(row_data ->> 'product_key', row_data ->> 'user_id')
      ), ''),
      'unknown'
    ),
    tg_op,
    old_record,
    new_record,
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.coconibz_consume_stock_for_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_shop_id text;
  sale_user_id uuid;
begin
  select s.shop_id, s.recorded_by
    into sale_shop_id, sale_user_id
    from public.retailer_sales s
    where s.id = new.sale_id;

  insert into public.stock_movements (
    shop_id, product_key, movement_type, quantity_change, sale_id, note, created_by
  )
  values (
    sale_shop_id, new.product_key, 'sale', -new.quantity, new.sale_id, 'Retail sale', sale_user_id
  );

  return new;
end;
$$;

create or replace function public.coconibz_apply_completed_order_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  movement_quantity integer;
begin
  if new.shop_id is null then
    return new;
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    movement_quantity := -1;
  elsif old.status = 'completed' and new.status <> 'completed' then
    movement_quantity := 1;
  else
    return new;
  end if;

  for item in
    select oi.product_key, oi.quantity
    from public.order_items oi
    where oi.order_id = new.id
  loop
    insert into public.stock_movements (
      shop_id, product_key, movement_type, quantity_change, order_id, note, created_by
    )
    values (
      new.shop_id,
      item.product_key,
      case when movement_quantity < 0 then 'order_fulfillment' else 'adjustment' end,
      item.quantity * movement_quantity,
      new.id,
      case when movement_quantity < 0 then 'Completed pickup order' else 'Order completion reversed' end,
      auth.uid()
    );
  end loop;

  return new;
end;
$$;

create or replace function public.coconibz_record_retailer_sale(
  p_shop_id text,
  p_items jsonb,
  p_payment_method text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  item jsonb;
  item_key text;
  item_quantity integer;
  product_name text;
  product_price integer;
  sale_total integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in before recording a sale';
  end if;

  if not public.has_coconibz_shop_access(p_shop_id) then
    raise exception 'You are not assigned to this shop';
  end if;

  if p_payment_method is not null
     and p_payment_method not in ('cash', 'mobile_money', 'other') then
    raise exception 'Choose a valid payment method';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sale items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 3 then
    raise exception 'Choose between one and three products';
  end if;

  insert into public.retailer_sales (shop_id, payment_method, note, recorded_by)
  values (p_shop_id, p_payment_method, nullif(trim(p_note), ''), auth.uid())
  returning id into v_sale_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_key := item ->> 'product_key';
    if coalesce(item ->> 'quantity', '') !~ '^[0-9]+$' then
      raise exception 'Sale quantities must be whole numbers';
    end if;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity < 1 then
      raise exception 'Sale quantities must be positive';
    end if;

    if (
      select count(*)
      from jsonb_array_elements(p_items) as sale_item(value)
      where value ->> 'product_key' = item_key
    ) > 1 then
      raise exception 'Each product can only appear once in a sale';
    end if;

    select p.name, p.unit_price
      into product_name, product_price
      from public.coconibz_products p
      where p.product_key = item_key and p.is_active;
    if not found then
      raise exception 'Sale contains an unavailable product';
    end if;

    insert into public.retailer_sale_items (
      sale_id, product_key, product_name, quantity, unit_price
    )
    values (v_sale_id, item_key, product_name, item_quantity, product_price);

    sale_total := sale_total + (item_quantity * product_price);
  end loop;

  update public.retailer_sales s
    set total_amount = sale_total
    where s.id = v_sale_id;

  return v_sale_id;
end;
$$;

create or replace function public.coconibz_admin_restock(
  p_shop_id text,
  p_product_key text,
  p_quantity integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_id uuid;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can record a restock';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Restock quantity must be positive';
  end if;

  insert into public.stock_movements (
    shop_id, product_key, movement_type, quantity_change, note, created_by
  )
  values (p_shop_id, p_product_key, 'restock', p_quantity, nullif(trim(p_note), ''), auth.uid())
  returning id into movement_id;

  return movement_id;
end;
$$;

create or replace function public.coconibz_record_order_payment(
  p_order_id uuid,
  p_method text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_id uuid;
  order_amount integer;
begin
  if auth.uid() is null or not public.is_coconibz_admin() then
    raise exception 'Only an admin can record order payments';
  end if;
  if p_method not in ('cash', 'mobile_money', 'other')
     or p_status not in ('pending', 'paid', 'failed', 'refunded') then
    raise exception 'Invalid payment method or status';
  end if;

  select o.total into order_amount
    from public.orders o
    where o.id = p_order_id
    for update;
  if not found then
    raise exception 'Order not found';
  end if;

  insert into public.payments (order_id, method, status, amount, paid_at, recorded_by)
  values (
    p_order_id,
    p_method,
    p_status,
    order_amount,
    case when p_status = 'paid' then now() else null end,
    auth.uid()
  )
  returning id into payment_id;

  update public.orders o
    set financial_status = p_status,
        payment_method = p_method
    where o.id = p_order_id;

  return payment_id;
end;
$$;

create trigger coconibz_stock_movement_updates_inventory
after insert on public.stock_movements
for each row execute function public.coconibz_apply_stock_movement();

create trigger coconibz_sale_item_consumes_stock
after insert on public.retailer_sale_items
for each row execute function public.coconibz_consume_stock_for_sale();

create trigger coconibz_completed_order_updates_inventory
after update of status on public.orders
for each row execute function public.coconibz_apply_completed_order_stock();

create trigger coconibz_audit_orders
after insert or update or delete on public.orders
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_order_items
after insert or update or delete on public.order_items
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_products
after insert or update or delete on public.coconibz_products
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_inventory
after insert or update or delete on public.shop_inventory
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_stock_movements
after insert or update or delete on public.stock_movements
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_retailer_sales
after insert or update or delete on public.retailer_sales
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_sale_items
after insert or update or delete on public.retailer_sale_items
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_payments
after insert or update or delete on public.payments
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_feedback
after insert or update or delete on public.customer_feedback
for each row execute function public.coconibz_record_audit_log();

create trigger coconibz_audit_retailer_assignments
after insert or update or delete on public.retailer_shops
for each row execute function public.coconibz_record_audit_log();

alter table public.coconibz_products enable row level security;
alter table public.shop_inventory enable row level security;
alter table public.retailer_sales enable row level security;
alter table public.retailer_sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.payments enable row level security;
alter table public.customer_feedback enable row level security;
alter table public.coconibz_audit_logs enable row level security;

revoke all on
  public.coconibz_products,
  public.shop_inventory,
  public.retailer_sales,
  public.retailer_sale_items,
  public.stock_movements,
  public.payments,
  public.customer_feedback,
  public.coconibz_audit_logs
from anon, authenticated;
revoke all on sequence
  public.coconibz_audit_logs_id_seq
from anon, authenticated;

grant select, insert, update, delete on public.coconibz_products to authenticated;
grant select on
  public.shop_inventory,
  public.retailer_sales,
  public.retailer_sale_items,
  public.payments,
  public.coconibz_audit_logs
to authenticated;
grant select, insert on public.stock_movements to authenticated;
grant select, insert, update, delete on public.customer_feedback to authenticated;

create policy "Authenticated users can view active products"
on public.coconibz_products for select to authenticated
using (is_active or (select public.is_coconibz_admin()));

create policy "Admins manage products"
on public.coconibz_products for all to authenticated
using ((select public.is_coconibz_admin()))
with check ((select public.is_coconibz_admin()));

create policy "Users view inventory for their shops"
on public.shop_inventory for select to authenticated
using ((select public.has_coconibz_shop_access(shop_id)));

create policy "Users view stock movements for their shops"
on public.stock_movements for select to authenticated
using ((select public.has_coconibz_shop_access(shop_id)));

create policy "Admins can record stock movements"
on public.stock_movements for insert to authenticated
with check ((select public.is_coconibz_admin()));

create policy "Users view sales for their shops"
on public.retailer_sales for select to authenticated
using ((select public.has_coconibz_shop_access(shop_id)));

create policy "Users view items for their shop sales"
on public.retailer_sale_items for select to authenticated
using (
  exists (
    select 1
    from public.retailer_sales s
    where s.id = sale_id
      and (select public.has_coconibz_shop_access(s.shop_id))
  )
);

create policy "Admins view payments"
on public.payments for select to authenticated
using ((select public.is_coconibz_admin()));

create policy "Users view feedback for their shops"
on public.customer_feedback for select to authenticated
using (
  (select public.is_coconibz_admin())
  or (
    shop_id is not null
    and (select public.has_coconibz_shop_access(shop_id))
  )
);

create policy "Admins and assigned retailers record feedback"
on public.customer_feedback for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and (
    (select public.is_coconibz_admin())
    or (
      shop_id is not null
      and (select public.has_coconibz_shop_access(shop_id))
    )
  )
);

create policy "Admins update or delete feedback"
on public.customer_feedback for update to authenticated
using ((select public.is_coconibz_admin()))
with check ((select public.is_coconibz_admin()));

create policy "Admins delete feedback"
on public.customer_feedback for delete to authenticated
using ((select public.is_coconibz_admin()));

create policy "Only admins can read operations audit logs"
on public.coconibz_audit_logs for select to authenticated
using ((select public.is_coconibz_admin()));

revoke all on function public.coconibz_record_retailer_sale(text, jsonb, text, text) from public, anon;
revoke all on function public.coconibz_admin_restock(text, text, integer, text) from public, anon;
revoke all on function public.coconibz_record_order_payment(uuid, text, text) from public, anon;
grant execute on function public.coconibz_record_retailer_sale(text, jsonb, text, text) to authenticated;
grant execute on function public.coconibz_admin_restock(text, text, integer, text) to authenticated;
grant execute on function public.coconibz_record_order_payment(uuid, text, text) to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'orders',
      'shop_inventory',
      'retailer_sales',
      'payments',
      'customer_feedback'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
