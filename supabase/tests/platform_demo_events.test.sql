-- 20260918150000: a demo's screen-view events are reachable only by the
-- service role, are bounded to one known event name and a shaped screen key,
-- and disappear with the site they belong to.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(18);

insert into public.platform_demo_sites (
  token_hash, business_name, industry_key, pack, state
) values
  (repeat('a', 64), 'Harbor Roast', 'coffee-shop', '{}'::jsonb, 'ready'),
  (repeat('b', 64), 'Old Mill Bakery', 'general', '{}'::jsonb, 'ready');

-- Captured now, as text, so the post-cascade assertions below still name the
-- first site once its row -- and the inline lookup by token_hash everywhere
-- else in this file -- is gone.
select id::text as site_a from public.platform_demo_sites where token_hash = repeat('a', 64) \gset

select throws_ok(
  $q$insert into public.platform_demo_events (site_id, screen)
     values ((select id from public.platform_demo_sites where token_hash = repeat('a', 64)), 'Not Valid!')$q$,
  '23514', null, 'a screen key must match the bounded shape');
select throws_ok(
  $q$insert into public.platform_demo_events (site_id, screen, event_name)
     values ((select id from public.platform_demo_sites where token_hash = repeat('a', 64)), 'home', 'interaction.completed')$q$,
  '23514', null, 'only screen.viewed is accepted today');
select throws_ok(
  $q$insert into public.platform_demo_events (site_id, screen)
     values ('00000000-0000-4000-8000-000000000000', 'home')$q$,
  '23503', null, 'an event cannot point at a site that does not exist');

insert into public.platform_demo_events (site_id, screen) values
  ((select id from public.platform_demo_sites where token_hash = repeat('a', 64)), 'home');
select is((select event_name from public.platform_demo_events where screen = 'home'), 'screen.viewed',
  'event_name defaults to screen.viewed');

set local role anon;
select throws_ok($q$select count(*) from public.platform_demo_events$q$,
  '42501', null, 'an anonymous caller cannot read demo events');
select throws_ok(
  $q$insert into public.platform_demo_events (site_id, screen)
     values ((select id from public.platform_demo_sites where token_hash = repeat('a', 64)), 'home')$q$,
  '42501', null, 'an anonymous caller cannot write a demo event');
reset role;

insert into auth.users (id, email) values
  ('e0000000-1000-4000-8000-000000000001', 'admin@demo-events.test');
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'e0000000-1000-4000-8000-000000000001', true);
select throws_ok($q$select count(*) from public.platform_demo_events$q$,
  '42501', null, 'a signed-in user -- platform admin or not -- cannot read demo events; there is no policy for it');
select throws_ok(
  $q$insert into public.platform_demo_events (site_id, screen)
     values ((select id from public.platform_demo_sites where token_hash = repeat('a', 64)), 'home')$q$,
  '42501', null, 'a signed-in user cannot write a demo event');
select throws_ok($q$select * from public.platform_demo_event_counts(array[]::uuid[])$q$,
  '42501', null, 'a signed-in user cannot call the counts rollup either');
reset role;

set local role service_role;
insert into public.platform_demo_events (site_id, screen) values
  ((select id from public.platform_demo_sites where token_hash = repeat('a', 64)), 'order'),
  ((select id from public.platform_demo_sites where token_hash = repeat('b', 64)), 'home');

select is(
  (select counted.screen_views from public.platform_demo_event_counts(array[
     (select id from public.platform_demo_sites where token_hash = repeat('a', 64)),
     (select id from public.platform_demo_sites where token_hash = repeat('b', 64))
   ]) counted
   where counted.site_id = (select id from public.platform_demo_sites where token_hash = repeat('a', 64))),
  2::bigint, 'the rollup counts two screen views for the first site');
select is(
  (select counted.screen_views from public.platform_demo_event_counts(array[
     (select id from public.platform_demo_sites where token_hash = repeat('a', 64)),
     (select id from public.platform_demo_sites where token_hash = repeat('b', 64))
   ]) counted
   where counted.site_id = (select id from public.platform_demo_sites where token_hash = repeat('b', 64))),
  1::bigint, 'and one for the second, in the same call');
select isnt(
  (select counted.last_viewed_at from public.platform_demo_event_counts(array[
     (select id from public.platform_demo_sites where token_hash = repeat('a', 64))
   ]) counted),
  null, 'the rollup also reports when the last view landed');
select is((select count(*)::integer from public.platform_demo_event_counts(array[]::uuid[])), 0,
  'an empty request rolls up nothing, not every site');
select is((select count(*)::integer from public.platform_demo_event_counts(
    array['00000000-0000-4000-8000-000000000099'::uuid])), 0,
  'a site with no events is simply absent from the rollup');

select is((select count(*)::integer from public.platform_demo_events where site_id::text = :'site_a'), 2,
  'two events are on the books for the first site before it is deleted');
delete from public.platform_demo_sites where token_hash = repeat('a', 64);
select is((select count(*)::integer from public.platform_demo_events where site_id::text = :'site_a'), 0,
  'deleting a demo site cascades to its events');
select is((select count(*)::integer from public.platform_demo_events
    where site_id = (select id from public.platform_demo_sites where token_hash = repeat('b', 64))), 1,
  'a sibling site''s events are untouched');
reset role;

select lives_ok($q$select app.assert_platform_demo_events()$q$,
  'release readiness verifies row level security, no policy, cascade, coverage and the client-role gate');

select * from finish();
rollback;
