begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(5);

select dblink_connect('package_worker_a', 'dbname=' || current_database());
select dblink_connect('package_worker_b', 'dbname=' || current_database());
select dblink_exec('package_worker_b', $setup$
  create table if not exists public.tenant_package_cleanup_concurrency_results (
    worker text primary key,
    claim_id uuid not null
  );
  truncate public.tenant_package_cleanup_concurrency_results;
  delete from storage.objects where name like
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/%';
  delete from app_private.tenant_package_upload_sessions
    where brand_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  delete from public.brands where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  insert into public.brands (id, slug, name, status) values
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
     'package-cleanup-concurrency', 'Package Cleanup Concurrency', 'active');
  insert into app_private.tenant_package_upload_sessions (
    id, brand_id, release_key, artifact_digest, source_commit_sha,
    envelope_sha256, archive_sha256, object_prefix, file_count,
    total_bytes, expires_at
  ) values (
    'eeeeeeee-0000-4000-8000-000000000001',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cleanup-2026.09.08',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    1, 10, now() - interval '1 minute'
  );
  insert into storage.objects (id, bucket_id, name) values (
    gen_random_uuid(), 'tenant-packages',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/archive.zip'
  );
$setup$);

select is(dblink_send_query('package_worker_a', $worker_a$
  with claimed as materialized (
    select * from public.claim_tenant_package_cleanup_candidates(500)
  ), recorded as (
    insert into public.tenant_package_cleanup_concurrency_results (worker, claim_id)
    select 'a', claim_id from claimed limit 1 returning claim_id
  ), paused as materialized (
    select pg_sleep(3) from recorded
  )
  select claim_id::text from recorded cross join paused
$worker_a$), 1, 'the first cleanup worker starts an asynchronous claim');
select pg_sleep(0.5);
select is(dblink_is_busy('package_worker_a'), 1,
  'the first cleanup worker holds the namespace lease');
select results_eq($test$
  select claimed_count from dblink('package_worker_b', $worker_b$
    select count(*)::integer as claimed_count
    from public.claim_tenant_package_cleanup_candidates(500)
  $worker_b$) as result(claimed_count integer)
$test$, $expected$ values (0) $expected$,
  'a waiter cannot overwrite an active namespace claim');
select results_eq($test$
  select claim_id from dblink_get_result('package_worker_a') as result(claim_id uuid)
$test$, $expected$
  select claim_id from public.tenant_package_cleanup_concurrency_results where worker = 'a'
$expected$, 'the first worker retains its claim identity');
select results_eq($test$
  select upload_session.purge_claim_id
  from app_private.tenant_package_upload_sessions upload_session
  where upload_session.id = 'eeeeeeee-0000-4000-8000-000000000001'
$test$, $expected$
  select claim_id from public.tenant_package_cleanup_concurrency_results where worker = 'a'
$expected$, 'the durable session still belongs to the first worker');

select dblink_exec('package_worker_b', $cleanup$
  delete from storage.objects where name like
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/%';
  delete from app_private.tenant_package_upload_sessions
    where brand_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  delete from public.brands where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  drop table public.tenant_package_cleanup_concurrency_results;
$cleanup$);
select dblink_disconnect('package_worker_a');
select dblink_disconnect('package_worker_b');

select * from finish();
rollback;
