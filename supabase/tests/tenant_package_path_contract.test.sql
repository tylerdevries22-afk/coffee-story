begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(32);

select has_function('public', 'claim_tenant_package_cleanup_candidates', array['integer'],
  'cleanup claims are bounded in the database');
select has_function('public', 'renew_tenant_package_purge_claim', array['uuid'],
  'cleanup ownership has a heartbeat');
select has_function('public', 'confirm_tenant_package_purge_claim', array['uuid'],
  'cleanup completion is finalized atomically');
select ok(
  has_function_privilege('service_role',
    'public.claim_tenant_package_cleanup_candidates(integer)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.renew_tenant_package_purge_claim(uuid)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.confirm_tenant_package_purge_claim(uuid)', 'EXECUTE'),
  'service credentials own the complete cleanup lifecycle');
select ok(
  not has_function_privilege('anon',
    'public.claim_tenant_package_cleanup_candidates(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.claim_tenant_package_cleanup_candidates(integer)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.renew_tenant_package_purge_claim(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.confirm_tenant_package_purge_claim(uuid)', 'EXECUTE'),
  'client roles cannot operate cleanup leases');
select ok(not exists (
  select 1 from pg_proc procedure_row
  cross join lateral aclexplode(coalesce(
    procedure_row.proacl, acldefault('f', procedure_row.proowner)
  )) privilege_row
  where procedure_row.oid in (
    'public.claim_tenant_package_cleanup_candidates(integer)'::regprocedure,
    'public.renew_tenant_package_purge_claim(uuid)'::regprocedure,
    'public.confirm_tenant_package_purge_claim(uuid)'::regprocedure
  ) and privilege_row.grantee = 0 and privilege_row.privilege_type = 'EXECUTE'
), 'PUBLIC cannot execute cleanup RPCs');
select ok(not exists (
  select 1 from unnest(array[
    'app_private.tenant_package_upload_sessions'::regclass,
    'app_private.tenant_package_purge_claim_outcomes'::regclass
  ]) private_table(oid)
  cross join unnest(array['service_role', 'anon', 'authenticated']) role_name(name)
  where has_table_privilege(role_name.name, private_table.oid,
    'SELECT,INSERT,UPDATE,DELETE')
), 'private cleanup state denies all direct client and service DML');
select ok(not exists (
  select 1 from pg_class sequence_row
  join pg_depend dependency on dependency.objid = sequence_row.oid
  cross join unnest(array['service_role', 'anon', 'authenticated']) role_name(name)
  where sequence_row.relkind = 'S'
    and dependency.refobjid in (
      'app_private.tenant_package_upload_sessions'::regclass,
      'app_private.tenant_package_purge_claim_outcomes'::regclass
    ) and has_sequence_privilege(role_name.name, sequence_row.oid,
      'USAGE,SELECT,UPDATE')
), 'private cleanup state exposes no backing sequence');
select ok(exists (
  select 1 from pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.conrelid = 'app_private.tenant_package_upload_sessions'::regclass
    and constraint_row.confrelid = 'public.tenant_package_releases'::regclass
    and pg_get_constraintdef(constraint_row.oid)
      like 'FOREIGN KEY (staged_release_id, brand_id) REFERENCES%'
), 'staged uploads use the exact composite release foreign key');
select matches((select indexdef from pg_indexes
  where schemaname = 'app_private'
    and indexname = 'tenant_package_upload_sessions_staged_release_idx'),
  '\(staged_release_id, brand_id\)', 'the composite foreign key has a child-leading index');

select ok(app_private.is_canonical_tenant_package_prefix(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'canonical PostgreSQL UUID text supports a legacy namespace');
select ok(app_private.is_canonical_tenant_package_prefix(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64)),
  'canonical PostgreSQL UUID text supports a modern namespace');
select ok(app_private.is_canonical_tenant_package_prefix(
  'ffffffff-ffff-ffff-ffff-ffffffffffff/' || repeat('a', 64)),
  'UUID syntax is canonical without an invented version restriction');
select ok(not app_private.is_canonical_tenant_package_prefix(
  'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/' || repeat('a', 64)),
  'noncanonical uppercase UUID text is rejected');
select ok(app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/archive.zip',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'legacy archives are recognized');
select ok(app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/a',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'legacy files are recognized');
select ok(app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/previews/a.png',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'legacy previews are recognized');
select ok(app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64) || '/files/a',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64)),
  'modern files are recognized');
select ok(app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64) || '/previews/a.png',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64)),
  'modern previews are recognized');
select ok(not app_private.is_tenant_package_namespace_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64) || '/archive.zip',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'legacy cleanup excludes an entire canonical modern subtree');
select ok(app_private.is_tenant_package_namespace_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64) || '/archive.zip',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/' || repeat('b', 64)),
  'modern cleanup includes its own namespace');
select ok(not app_private.is_deletable_tenant_package_object(
  'not-a-prefix/files/a', 'not-a-prefix'), 'noncanonical prefixes are rejected');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/a/',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'trailing slashes are rejected');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/a//b',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'empty path components are rejected');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/a/../b',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'dot path components are rejected');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/a' || chr(92) || 'b',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'backslashes are rejected');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/a' || chr(1) || 'b',
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'control bytes are rejected');
select ok(app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/' || repeat('x', 1392),
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'a 1,500-byte object name is accepted');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/' || repeat('x', 1393),
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'a 1,501-byte object name is rejected');
select ok(not app_private.is_deletable_tenant_package_object(
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64) || '/files/' || repeat('é', 700),
  '00000000-0000-0000-0000-000000000000/' || repeat('a', 64)),
  'the object limit counts UTF-8 bytes');
select ok((select count(*) = 5 and bool_and(pg_get_constraintdef(oid) like '%octet_length%')
  from pg_constraint where conrelid in (
    'public.tenant_package_releases'::regclass,
    'public.tenant_package_files'::regclass
  ) and conname in (
    'tenant_package_releases_archive_object_path_check',
    'tenant_package_files_relative_path_check',
    'tenant_package_files_path_key_check',
    'tenant_package_files_object_path_check',
    'tenant_package_files_preview_object_path_check'
  )), 'persisted path constraints count UTF-8 bytes');
select ok(to_regprocedure(
  'public.stage_tenant_package(uuid,text,text,text,text,text,text,integer,bigint,jsonb)'
) is null, 'the sessionless stage overload is absent');

select * from finish();
rollback;
