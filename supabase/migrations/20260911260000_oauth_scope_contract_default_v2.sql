-- New Square connections mint under the current OAuth scope contract (v2).
-- Existing v1 rows stay v1; HQ still refuses them until the merchant reconnects.

alter table public.square_connections
  alter column oauth_scope_contract_version set default 2;

create or replace function app.assert_oauth_scope_contract_default()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  default_value text;
begin
  select pg_catalog.pg_get_expr(def.adbin, def.adrelid) into default_value
  from pg_catalog.pg_attrdef def
  join pg_catalog.pg_attribute att
    on att.attrelid = def.adrelid and att.attnum = def.adnum
  join pg_catalog.pg_class cls on cls.oid = def.adrelid
  join pg_catalog.pg_namespace nsp on nsp.oid = cls.relnamespace
  where nsp.nspname = 'public'
    and cls.relname = 'square_connections'
    and att.attname = 'oauth_scope_contract_version';
  if default_value is distinct from '2' then
    raise exception 'oauth_scope_contract_version default must be 2, got %', default_value;
  end if;
end $$;

revoke all on function app.assert_oauth_scope_contract_default()
  from public, anon, authenticated;
grant execute on function app.assert_oauth_scope_contract_default()
  to service_role;

select app.register_release(
  '20260911260000',
  'new Square connections default to OAuth scope contract 2',
  'app.assert_oauth_scope_contract_default()'::regprocedure
);
