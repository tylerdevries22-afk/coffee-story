-- 20260918130000: the demo factory builds nothing until it is turned on, never
-- more than the day's count or budget allows, never one business twice at
-- once, and never rewrites what it spent.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(28);

insert into auth.users (id, email) values
  ('d0000000-2000-4000-8000-000000000001', 'operator@demo-runs.test');
insert into public.platform_demo_sites (token_hash, google_place_id, business_name, industry_key, state)
values (repeat('a', 64), 'ChIJAlreadyLive', 'Live Already', 'coffee-shop', 'ready');
insert into public.platform_demo_suppressions (kind, value, reason)
values ('google_place', 'ChIJAskedToLeave', 'owner_request');

set local role service_role;

select results_eq(
  $q$select found, queued from public.create_platform_demo_batch(
       'coffee shops in Boulder, CO', 5,
       array['ChIJFirstShop', 'ChIJSecondShop', 'ChIJAlreadyLive', 'ChIJAskedToLeave', 'ChIJFirstShop'],
       50000, 'd0000000-2000-4000-8000-000000000001')$q$,
  $q$values (4, 2)$q$,
  'a batch queues only businesses that are new, not suppressed and not already live');
select is(
  (select array_agg(job.google_place_id || ':' || job.state || ':' || coalesce(job.outcome, '-')
                    order by job.google_place_id collate "C")
     from public.platform_demo_jobs as job),
  array['ChIJAlreadyLive:skipped:already_live', 'ChIJAskedToLeave:skipped:suppressed',
        'ChIJFirstShop:queued:-', 'ChIJSecondShop:queued:-'],
  'and records why the others were skipped, before anything is billed for them');
select results_eq(
  $q$select found, queued from public.create_platform_demo_batch(
       'bakeries near Pearl Street', 2, array['ChIJFirstShop', 'ChIJThirdShop'], 50000, null)$q$,
  $q$values (2, 1)$q$,
  'a business another batch is already building is not queued twice');
select results_eq(
  $q$select found, queued from public.create_platform_demo_batch(
       'already covered', 1, array['ChIJAlreadyLive'], 0, null)$q$,
  $q$values (1, 0)$q$,
  'a batch can find a business and have nothing to build');
select is(
  (select row(batch.state, batch.finished_at is not null)::text
     from public.platform_demo_batches as batch where batch.query = 'already covered'),
  row('done', true)::text,
  'so it is born finished');
select throws_ok(
  $q$select * from public.create_platform_demo_batch('too many', 1, array['ChIJAaaaaaa', 'ChIJBbbbbbb'], 0, null)$q$,
  '23514', null, 'a batch cannot build more businesses than it asked for');

update public.platform_demo_jobs set created_at = now() - interval '3 minutes'
 where google_place_id = 'ChIJFirstShop' and state = 'queued';
update public.platform_demo_jobs set created_at = now() - interval '2 minutes'
 where google_place_id = 'ChIJSecondShop';
update public.platform_demo_jobs set created_at = now() - interval '1 minute'
 where google_place_id = 'ChIJThirdShop';

select is((select count(*) from public.claim_platform_demo_jobs(10))::integer, 0,
  'the factory builds nothing until someone turns it on');

update public.platform_demo_settings set enabled = true, daily_limit = 2;
select is(
  (select array_agg(claimed.google_place_id order by claimed.google_place_id collate "C")
     from public.claim_platform_demo_jobs(10) as claimed),
  array['ChIJFirstShop', 'ChIJSecondShop'],
  'a tick takes the oldest jobs, and no more than the day''s count allows');
select is((select count(*) from public.claim_platform_demo_jobs(10))::integer, 0,
  'and none once the day''s count is used up');
select is(
  (select row(job.state, job.attempts, job.lease_expires_at > now(), job.claimed_at is not null)::text
     from public.platform_demo_jobs as job where job.google_place_id = 'ChIJFirstShop' and job.state = 'working'),
  row('working', 1, true, true)::text,
  'a claimed job is leased to its attempt');

insert into public.platform_demo_sites (token_hash, google_place_id, business_name, industry_key, state)
values (repeat('b', 64), 'ChIJFirstShop', 'First Shop', 'coffee-shop', 'ready'),
       (repeat('c', 64), 'ChIJSecondShop', 'Second Shop', 'coffee-shop', 'ready');

select is(
  public.finish_platform_demo_job(
    (select id from public.platform_demo_jobs where google_place_id = 'ChIJFirstShop' and state = 'working'),
    2, 'built', null, (select id from public.platform_demo_sites where token_hash = repeat('b', 64))),
  false,
  'an attempt that no longer holds the lease cannot settle the job');
select is(
  public.finish_platform_demo_job(
    (select id from public.platform_demo_jobs where google_place_id = 'ChIJFirstShop' and state = 'working'),
    1, 'built', null, (select id from public.platform_demo_sites where token_hash = repeat('b', 64))),
  true,
  'the attempt holding the lease settles it');
select is(
  public.finish_platform_demo_job(
    (select id from public.platform_demo_jobs where google_place_id = 'ChIJSecondShop'), 1, 'queued', 'places_timeout'),
  true,
  'a transient failure hands the job back');
select is(
  (select row(job.state, job.attempts, job.lease_expires_at, job.finished_at, job.outcome)::text
     from public.platform_demo_jobs as job where job.google_place_id = 'ChIJSecondShop'),
  row('queued', 1, null::timestamptz, null::timestamptz, 'places_timeout')::text,
  'with its lease released and the reason kept');

update public.platform_demo_settings set daily_limit = 10;
select is((select count(*) from public.claim_platform_demo_jobs(10))::integer, 2,
  'a job handed back is claimed again, next to the ones still waiting');

update public.platform_demo_jobs set lease_expires_at = now() - interval '1 second'
 where google_place_id = 'ChIJThirdShop' and state = 'working';
select is(
  (select claimed.attempt from public.claim_platform_demo_jobs(10) as claimed
    where claimed.google_place_id = 'ChIJThirdShop'),
  2,
  'a lease that expired is a crashed attempt, and the job is tried again');

update public.platform_demo_jobs set attempts = 3, lease_expires_at = now() - interval '1 second'
 where google_place_id = 'ChIJThirdShop' and state = 'working';
select is((select count(*) from public.claim_platform_demo_jobs(10))::integer, 0,
  'a third crashed attempt is not retried');
select is(
  (select job.state || ':' || job.outcome from public.platform_demo_jobs as job
    where job.google_place_id = 'ChIJThirdShop' and job.state <> 'skipped'),
  'failed:abandoned',
  'it fails as abandoned instead');

select is(
  public.finish_platform_demo_job(
    (select id from public.platform_demo_jobs where google_place_id = 'ChIJSecondShop'),
    2, 'built', null, (select id from public.platform_demo_sites where token_hash = repeat('c', 64))),
  true,
  'the retried job is built');
select is(
  (select batch.state from public.platform_demo_batches as batch where batch.query = 'coffee shops in Boulder, CO'),
  'done',
  'a batch is done when its last business settles');

insert into public.platform_demo_costs (batch_id, job_id, provider, sku, quantity, cost_microusd)
select job.batch_id, job.id, 'google_places', 'place_details_enterprise', 1, 20000
  from public.platform_demo_jobs as job where job.google_place_id = 'ChIJFirstShop' and job.state = 'built';
select is(
  (select cost.cost_microusd from public.platform_demo_job_costs(
     (select id from public.platform_demo_batches where query = 'coffee shops in Boulder, CO')) as cost
    where cost.google_place_id = 'ChIJFirstShop'),
  20000::bigint,
  'what one business cost is the sum of its ledger rows');

select results_eq(
  $q$select found, queued from public.create_platform_demo_batch(
       'florists downtown', 1, array['ChIJFourthShop'], 50000, null)$q$,
  $q$values (1, 1)$q$,
  'a new batch queues its business');
insert into public.platform_demo_costs (batch_id, provider, sku, quantity, cost_microusd)
select batch.id, 'openai', 'output_tokens', 5000000, 9980000
  from public.platform_demo_batches as batch where batch.query = 'florists downtown';
select is((select count(*) from public.claim_platform_demo_jobs(10))::integer, 0,
  'nothing more is built once today''s spend reaches the budget');
select is((select sum(daily.cost_microusd) from public.platform_demo_daily_costs() as daily)::bigint, 10000000::bigint,
  'the daily report shows the whole day''s spend');

select throws_ok($q$update public.platform_demo_costs set cost_microusd = 0$q$,
  '55000', 'record_is_append_only', 'what was spent cannot be rewritten');
select is(
  public.stop_platform_demo_batch((select id from public.platform_demo_batches where query = 'florists downtown')),
  1,
  'stopping a batch skips what has not started');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'd0000000-2000-4000-8000-000000000001', true);
select throws_ok($q$select * from public.claim_platform_demo_jobs(1)$q$,
  '42501', null, 'a signed-in user cannot hand out demo work');
reset role;

select lives_ok($q$select app.assert_platform_demo_runs()$q$,
  'release readiness verifies the brakes, the ledger and the grants');

select * from finish();
rollback;
