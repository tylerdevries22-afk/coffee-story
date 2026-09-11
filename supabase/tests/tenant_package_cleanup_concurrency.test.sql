begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(11);

select dblink_connect('package_worker_a', format(
  'host=127.0.0.1 port=%s dbname=%s user=%s password=postgres',
  current_setting('port'), current_database(), current_user));
select dblink_connect('package_worker_b', format(
  'host=127.0.0.1 port=%s dbname=%s user=%s password=postgres',
  current_setting('port'), current_database(), current_user));
select dblink_exec('package_worker_b', $setup$
  create table if not exists public.tenant_package_cleanup_concurrency_results (
    worker text primary key,
    claim_id uuid not null
  );
  truncate public.tenant_package_cleanup_concurrency_results;
  set local session_replication_role = replica;
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

select is(dblink_exec('package_worker_b', format($expire$
  update app_private.tenant_package_upload_sessions
  set purge_lease_until = clock_timestamp() - interval '1 second'
  where id = 'eeeeeeee-0000-4000-8000-000000000001'
    and purge_claim_id = %L
$expire$, (select claim_id::text
  from public.tenant_package_cleanup_concurrency_results where worker = 'a'))),
  'UPDATE 1', 'the first lease can expire after its worker loses contact');
select is(dblink_exec('package_worker_b', $reclaim$
  insert into public.tenant_package_cleanup_concurrency_results (worker, claim_id)
  select 'b', claim_id
  from public.claim_tenant_package_cleanup_candidates(500)
  limit 1
$reclaim$), 'INSERT 0 1', 'a new worker can reclaim an expired namespace lease');
select isnt(
  (select claim_id from public.tenant_package_cleanup_concurrency_results where worker = 'b'),
  (select claim_id from public.tenant_package_cleanup_concurrency_results where worker = 'a'),
  'reclaiming rotates the cleanup ownership token');
select set_config('test.old_claim_id', (select claim_id::text
  from public.tenant_package_cleanup_concurrency_results where worker = 'a'), true);
select set_config('test.new_claim_id', (select claim_id::text
  from public.tenant_package_cleanup_concurrency_results where worker = 'b'), true);
set local role service_role;
select throws_ok(format($test$ select public.renew_tenant_package_purge_claim(%L) $test$,
  current_setting('test.old_claim_id')), '23514', 'tenant_package_cleanup_claim_invalid',
  'a stale worker cannot renew ownership after claim rotation');
select cmp_ok(public.renew_tenant_package_purge_claim(
  current_setting('test.new_claim_id')::uuid), '>',
  clock_timestamp() + interval '9 minutes',
  'the current worker can renew a live cleanup lease');
reset role;
select is((select upload_session.purge_claim_id
  from app_private.tenant_package_upload_sessions upload_session
  where upload_session.id = 'eeeeeeee-0000-4000-8000-000000000001'),
  current_setting('test.new_claim_id')::uuid,
  'heartbeat failure never transfers ownership back to a stale worker');

select dblink_disconnect('package_worker_a');
select dblink_disconnect('package_worker_b');

select * from finish();
rollback;

set local session_replication_role = replica;
delete from storage.objects where name like
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/%';
delete from app_private.tenant_package_upload_sessions
  where brand_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
delete from public.brands where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
drop table public.tenant_package_cleanup_concurrency_results;
