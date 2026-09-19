-- 20260918120000: a demo site is reachable only through its hashed token, by
-- the service role, until it expires or its business asks to be removed --
-- and a removed business can never be demoed again.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(22);

insert into public.platform_demo_sites (
  token_hash, google_place_id, business_name, website_host, industry_key, country_code, pack, state
) values
  (repeat('a', 64), 'ChIJDemoPlaceOne', 'Harbor Roast', 'harbor.example', 'coffee-shop', 'US',
   '{"brand":{"identity":{"name":"Harbor Roast"}}}', 'ready'),
  (repeat('b', 64), 'ChIJDemoPlaceTwo', 'Old Mill Bakery', 'oldmill.example', 'general', 'US',
   '{"brand":{"identity":{"name":"Old Mill Bakery"}}}', 'ready');
insert into public.platform_demo_sites (
  token_hash, business_name, industry_key, pack, state, created_at, expires_at
) values (
  repeat('c', 64), 'Past Due Cafe', 'coffee-shop', '{"brand":{}}', 'ready',
  now() - interval '20 days', now() - interval '6 days'
);

select throws_ok(
  $q$insert into public.platform_demo_sites (token_hash, business_name, industry_key)
     values ('not-a-hash-but-the-raw-link-token', 'Raw Token', 'general')$q$,
  '23514', null, 'a raw bearer token cannot be stored in place of its hash');
select throws_ok(
  $q$insert into public.platform_demo_sites (token_hash, google_place_id, business_name, industry_key)
     values (repeat('d', 64), 'ChIJDemoPlaceOne', 'Second Pitch', 'general')$q$,
  '23505', null, 'one business cannot hold two live demos');

set local role anon;
select throws_ok($q$select count(*) from public.platform_demo_sites$q$,
  '42501', null, 'an anonymous caller cannot read demo sites');
select throws_ok($q$select * from public.open_platform_demo_site(repeat('a', 64))$q$,
  '42501', null, 'an anonymous caller cannot open a demo through the API');
reset role;

insert into auth.users (id, email) values
  ('d0000000-1000-4000-8000-000000000001', 'someone@demo-sites.test');
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'd0000000-1000-4000-8000-000000000001', true);
select is((select count(*) from public.platform_demo_sites)::integer, 0,
  'a signed-in user who is not a platform admin sees no demo site');
select throws_ok($q$select * from public.remove_platform_demo_site(repeat('a', 64))$q$,
  '42501', null, 'a signed-in user cannot remove a demo');
select throws_ok(
  $q$insert into public.platform_demo_sites (token_hash, business_name, industry_key)
     values (repeat('e', 64), 'Forged', 'general')$q$,
  '42501', null, 'a signed-in user cannot create a demo');
reset role;

set local role service_role;
select is((select count(*) from public.open_platform_demo_site(repeat('a', 64)))::integer, 1,
  'the service role opens a ready demo');
select is((select count(*) from public.open_platform_demo_site(repeat('a', 64)))::integer, 1,
  'and opens it again');
select is((select open_count from public.platform_demo_sites where token_hash = repeat('a', 64)), 2,
  'every open is counted');
select ok((select first_opened_at is not null from public.platform_demo_sites where token_hash = repeat('a', 64)),
  'the first open is kept');
select is((select count(*) from public.open_platform_demo_site(repeat('c', 64)))::integer, 0,
  'a demo past its window does not open, even before the sweep');
select is((select count(*) from public.open_platform_demo_site(repeat('f', 64)))::integer, 0,
  'an unknown token opens nothing');

select is((select count(*) from public.expire_platform_demo_sites())::integer, 1,
  'the sweep expires only the demo past its window');
select is((select pack from public.platform_demo_sites where token_hash = repeat('c', 64)), '{}'::jsonb,
  'expiry drops everything that was scraped');
select is((select business_name from public.platform_demo_sites where token_hash = repeat('c', 64)),
  'Past Due Cafe', 'expiry keeps the name, so the link can say whose demo it was');

select is((select count(*) from public.remove_platform_demo_site(repeat('b', 64)))::integer, 1,
  'removal takes one call');
select is(
  (select row(state, pack, business_name, google_place_id, website_host)::text
     from public.platform_demo_sites where token_hash = repeat('b', 64)),
  row('removed', '{}'::jsonb, 'Removed', null::text, null::text)::text,
  'removal wipes the pack, the name and the identifiers in the same statement');
select is(
  (select array_agg(kind || ':' || value order by kind) from public.platform_demo_suppressions),
  array['google_place:ChIJDemoPlaceTwo', 'website_host:oldmill.example'],
  'the business and its website are suppressed');
select is((select count(*) from public.remove_platform_demo_site(repeat('b', 64)))::integer, 0,
  'removing twice is a no-op, not an error');
select throws_ok(
  $q$insert into public.platform_demo_sites (token_hash, google_place_id, business_name, industry_key)
     values (repeat('9', 64), 'ChIJDemoPlaceTwo', 'Old Mill Bakery', 'general')$q$,
  '23514', 'this business asked not to be demoed',
  'a removed business cannot be demoed again by its listing');
reset role;

select lives_ok($q$select app.assert_platform_demo_sites()$q$,
  'release readiness verifies the hash, the uniqueness, the suppression and the grants');

select * from finish();
rollback;
