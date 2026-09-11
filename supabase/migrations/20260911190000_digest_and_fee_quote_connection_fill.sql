-- pgcrypto lives in extensions; credential lifecycle SQL calls public.digest
-- under an empty search_path. Alias both pgcrypto signatures.
create or replace function public.digest(bytea, text)
returns bytea
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.digest($1, $2);
$$;

create or replace function public.digest(text, text)
returns bytea
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.digest($1, $2);
$$;

revoke all on function public.digest(bytea, text) from public;
grant execute on function public.digest(bytea, text) to public;
revoke all on function public.digest(text, text) from public;
grant execute on function public.digest(text, text) to public;

-- Quotes now require a Square connection. Fill from the location's current
-- connection when a writer omits the columns (tests and older insert paths).
create or replace function app.fill_platform_fee_quote_connection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.connection_id is not null and new.connection_generation is not null then
    return new;
  end if;
  select connection.id, connection.connection_generation
    into new.connection_id, new.connection_generation
  from public.square_connections connection
  where connection.location_id = new.location_id
  limit 1;
  return new;
end $$;

drop trigger if exists fill_platform_fee_quote_connection on public.platform_fee_quotes;
create trigger fill_platform_fee_quote_connection
  before insert on public.platform_fee_quotes
  for each row
  execute function app.fill_platform_fee_quote_connection();

create or replace function app.assert_digest_and_fee_quote_connection_fill()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('public.digest(text, text)') is null
    or pg_catalog.to_regprocedure('public.digest(bytea, text)') is null then
    raise exception 'public.digest aliases are missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.platform_fee_quotes'::regclass
      and trigger_row.tgname = 'fill_platform_fee_quote_connection'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'platform_fee_quotes connection fill trigger is missing';
  end if;
end $$;

revoke all on function app.assert_digest_and_fee_quote_connection_fill()
  from public, anon, authenticated;
grant execute on function app.assert_digest_and_fee_quote_connection_fill()
  to service_role;

select app.register_release(
  '20260911190000',
  'public.digest aliases and platform_fee_quotes connection fill',
  'app.assert_digest_and_fee_quote_connection_fill()'::regprocedure
);
