do $$
declare
  v_column_name text;
  v_column_count bigint;
  v_column_type text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'full_name'
  ) then
    select count(*), min(column_name::text)
    into v_column_count, v_column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and ordinal_position = 2
      and data_type = 'text';

    if v_column_count <> 1 then
      raise exception 'Could not identify the profiles full-name column safely';
    end if;
    execute format('alter table public.profiles rename column %I to full_name', v_column_name);
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'phone'
  ) then
    select count(*), min(column_name::text)
    into v_column_count, v_column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and data_type = 'numeric';

    if v_column_count <> 1 then
      raise exception 'Could not identify the profiles phone column safely';
    end if;
    execute format('alter table public.profiles rename column %I to phone', v_column_name);
  end if;

  select data_type
  into v_column_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'phone';

  if v_column_type = 'numeric' then
    alter table public.profiles
      alter column phone type text using phone::text;
  elsif v_column_type is distinct from 'text' then
    raise exception 'The profiles phone column is neither numeric nor text';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'admin'
    ) then
      execute 'alter table public.profiles rename column admin to role';
    else
      raise exception 'Could not identify the profiles role column safely';
    end if;
  end if;
end;
$$;

alter table public.profiles
  alter column full_name set default '',
  alter column full_name set not null,
  alter column phone set not null,
  alter column role set default 'customer',
  alter column role set not null;
