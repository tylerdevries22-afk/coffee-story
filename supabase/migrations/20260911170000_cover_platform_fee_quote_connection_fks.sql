-- 20260908227000 added connection FKs on platform_fee_quotes without covering
-- indexes. The 20260830020000 readiness assertion still scans public FKs.

create index if not exists platform_fee_quotes_connection_id_idx
  on public.platform_fee_quotes (connection_id);
create index if not exists platform_fee_quotes_connection_generation_idx
  on public.platform_fee_quotes (connection_generation);

create or replace function app.assert_platform_fee_quote_connection_fk_indexes()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  missing integer;
begin
  select count(*)::integer into missing
    from unnest(array[
      'platform_fee_quotes_connection_id_idx',
      'platform_fee_quotes_connection_generation_idx'
    ]) as t(name)
    where not exists (
      select 1 from pg_catalog.pg_class cls
      join pg_catalog.pg_namespace nsp on nsp.oid = cls.relnamespace
      where nsp.nspname = 'public' and cls.relname = t.name and cls.relkind = 'i'
    );
  if missing > 0 then
    raise exception 'platform_fee_quotes connection FK covering indexes missing: %', missing;
  end if;
end $$;

revoke all on function app.assert_platform_fee_quote_connection_fk_indexes()
  from public, anon, authenticated;
grant execute on function app.assert_platform_fee_quote_connection_fk_indexes()
  to service_role;

select app.register_release(
  '20260911170000',
  'covering indexes for platform_fee_quotes connection FKs',
  'app.assert_platform_fee_quote_connection_fk_indexes()'::regprocedure
);
