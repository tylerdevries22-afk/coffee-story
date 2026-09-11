begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(169);

select has_table('public', 'tenant_package_releases', 'package releases are durable');
select has_table('public', 'tenant_package_files', 'package files are indexed');
select has_table('public', 'tenant_package_publications', 'current package has one pointer');
select has_table('public', 'tenant_package_publication_events', 'publication is audited');
select has_table('public', 'tenant_package_publication_compensations', 'rollback is audited');
select has_table('public', 'tenant_package_publication_compensation_confirmations',
  'provider restoration confirmation is audited');
select has_column('public', 'tenant_package_publication_events',
  'previous_package_release_id', 'events preserve the prior release');
select has_column('public', 'tenant_package_publication_events',
  'target_previous_status', 'events preserve the target before-image');
select has_column('public', 'tenant_package_publication_events',
  'previous_updated_at', 'events preserve the exact prior pointer version');
select has_function('public', 'publish_tenant_package_if_current', array[
  'uuid','text','text','text','text','text','uuid','text','text','timestamp with time zone'
], 'serialized publication RPC exists');
select has_function('public', 'compensate_tenant_package_publication', array[
  'uuid','uuid','text','text','text','text','text','uuid','text','text',
  'timestamp with time zone'
], 'compensation RPC exists');
select has_function('public', 'confirm_tenant_package_publication_compensation',
  array['uuid','uuid','text','text','text'], 'provider restoration RPC exists');
select has_function('public', 'stage_tenant_package', array[
  'uuid','text','text','text','text','text','text','integer','bigint','jsonb','uuid'
], 'session-bound staging RPC exists');
select hasnt_function('public', 'stage_tenant_package', array[
  'uuid','text','text','text','text','text','text','integer','bigint','jsonb'
], 'the ambiguous sessionless staging overload is absent');
select has_function('app', 'can_read_tenant_package', array['uuid'],
  'package authorization uses authoritative membership');

select ok(has_function_privilege('service_role', rpc, 'EXECUTE'),
  format('service_role may execute %s', rpc))
from unnest(array[
  'public.publish_tenant_package_if_current(uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'public.confirm_tenant_package_publication_compensation(uuid,uuid,text,text,text)',
  'public.record_organization_readiness(uuid,text,boolean,jsonb)'
]) rpc;
select ok(not has_function_privilege(role_name, rpc, 'EXECUTE'),
  format('%s may not execute %s', role_name, rpc))
from unnest(array['anon','authenticated']) role_name
cross join unnest(array[
  'public.publish_tenant_package_if_current(uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'public.confirm_tenant_package_publication_compensation(uuid,uuid,text,text,text)',
  'public.record_organization_readiness(uuid,text,boolean,jsonb)'
]) rpc;
select ok(not has_function_privilege(role_name,
  'public.publish_tenant_package(uuid,text,text,text,text,text)', 'EXECUTE'),
  format('%s cannot bypass serialized publication', role_name))
from unnest(array['anon','authenticated','service_role']) role_name;
select ok(coalesce((select procedure.prosecdef and procedure.proconfig @>
    array['search_path=""']::text[] from pg_proc procedure
  where procedure.oid = to_regprocedure(rpc)), false),
  format('%s is a hardened definer function', rpc))
from unnest(array[
  'public.publish_tenant_package(uuid,text,text,text,text,text)',
  'public.publish_tenant_package_if_current(uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'public.confirm_tenant_package_publication_compensation(uuid,uuid,text,text,text)',
  'public.record_organization_readiness(uuid,text,boolean,jsonb)'
]) rpc;

select ok(coalesce((select relrowsecurity from pg_class
  where oid = relation_name::regclass), false), format('%s has RLS', relation_name))
from unnest(array[
  'public.tenant_package_publication_events',
  'public.tenant_package_publication_compensations',
  'public.tenant_package_publication_compensation_confirmations'
]) relation_name;
select ok(has_table_privilege('service_role', relation_name, 'SELECT'),
  format('service_role may read %s', relation_name))
from unnest(array[
  'public.tenant_package_publication_events',
  'public.tenant_package_publication_compensations',
  'public.tenant_package_publication_compensation_confirmations'
]) relation_name;
select ok(not has_table_privilege(role_name, relation_name, 'SELECT'),
  format('%s may not read %s', role_name, relation_name))
from unnest(array['anon','authenticated']) role_name
cross join unnest(array[
  'public.tenant_package_publication_events',
  'public.tenant_package_publication_compensations',
  'public.tenant_package_publication_compensation_confirmations'
]) relation_name;
select ok(not has_table_privilege(role_name, relation_name, privilege_name),
  format('%s lacks %s on %s', role_name, privilege_name, relation_name))
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array[
  'public.tenant_package_publication_events',
  'public.tenant_package_publication_compensations',
  'public.tenant_package_publication_compensation_confirmations'
]) relation_name
cross join unnest(array[
  'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
]) privilege_name;
select ok(has_table_privilege('service_role', relation_name, 'SELECT'),
  format('service_role may inspect %s', relation_name))
from unnest(array[
  'public.tenant_package_releases','public.tenant_package_files',
  'public.tenant_package_publications','public.organization_readiness_checks'
]) relation_name;
select ok(not has_table_privilege('service_role', relation_name, privilege_name),
  format('service_role lacks direct %s on %s', privilege_name, relation_name))
from unnest(array[
  'public.tenant_package_releases','public.tenant_package_files',
  'public.tenant_package_publications','public.organization_readiness_checks'
]) relation_name
cross join unnest(array[
  'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
]) privilege_name;
select ok(not has_sequence_privilege(role_name, sequence_name, privilege_name),
  format('%s lacks %s on %s', role_name, privilege_name, sequence_name))
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array[
  'public.tenant_package_publication_events_id_seq',
  'public.tenant_package_publication_compensations_id_seq',
  'public.tenant_package_publication_compensation_confirmations_id_seq'
]) sequence_name
cross join unnest(array['USAGE','SELECT','UPDATE']) privilege_name;
select ok(to_regclass(index_name) is not null, format('%s exists', index_name))
from unnest(array[
  'public.tenant_package_publication_events_release_idx',
  'public.tenant_package_publication_events_previous_release_idx',
  'public.tenant_package_publication_compensations_event_brand_idx',
  'public.tenant_package_publication_compensations_brand_idx',
  'public.tenant_package_publication_compensations_failed_release_idx',
  'public.tenant_package_publication_compensations_restored_release_idx',
  'public.tenant_package_compensation_confirmations_comp_brand_idx',
  'public.tenant_package_compensation_confirmations_brand_idx'
]) index_name;
select ok(not exists (
  select 1 from pg_constraint constraint_row
  where constraint_row.contype = 'f' and constraint_row.conrelid in (
    'public.tenant_package_publication_events'::regclass,
    'public.tenant_package_publication_compensations'::regclass,
    'public.tenant_package_publication_compensation_confirmations'::regclass)
  and not exists (select 1 from pg_index index_row
    where index_row.indrelid = constraint_row.conrelid
      and index_row.indisvalid and index_row.indisready and index_row.indpred is null
      and index_row.indnkeyatts >= cardinality(constraint_row.conkey)
      and not exists (select 1 from unnest(constraint_row.conkey) with ordinality
        key_column(attribute_number, position)
        where (index_row.indkey::smallint[])[key_column.position - 1]
          is distinct from key_column.attribute_number))),
  'every publication child foreign key has a leading index');
select ok(exists(select 1 from pg_trigger where tgrelid = relation_name::regclass
    and tgname = trigger_name and not tgisinternal), format('%s is immutable', relation_name))
from (values
  ('public.tenant_package_publication_events','tenant_package_publication_events_immutable'),
  ('public.tenant_package_publication_compensations','tenant_package_publication_compensations_immutable'),
  ('public.tenant_package_publication_compensation_confirmations',
   'tenant_package_publication_compensation_confirmations_immutable')
) trigger_spec(relation_name, trigger_name);
select lives_ok('select app.assert_tenant_package_publication_compensation()',
  'release readiness verifies the publication and compensation contract');
select * from finish();
rollback;
