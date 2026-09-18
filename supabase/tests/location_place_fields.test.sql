-- 20260918140000: provisioning keeps the first location's Google Place id, map
-- pin, phone and website -- and refuses any of them malformed, leaving nothing
-- behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(22);

select has_column('public', 'locations', 'phone', 'a location can carry its phone');
select has_column('public', 'locations', 'website', 'a location can carry its website');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
('71717171-7171-4171-8171-717171717171', 'places-admin@example.test', '{}', '{}'),
('72727272-7272-4272-8272-727272727272', 'places-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', 'places-platform', 'Places Platform');
insert into public.brand_users (user_id, brand_id, role) values
('71717171-7171-4171-8171-717171717171', '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', 'platform_admin');

-- The first location as the console sends it after a Google pick, then the
-- same location with one thing changed at a time.
create temp table test_places (key text primary key, location jsonb not null);
insert into test_places (key, location) values ('google', '{
  "name": "Harbor Roast", "timezone": "America/Los_Angeles",
  "address": {"street": "12 Pier Street", "city": "Tacoma", "region": "WA", "postal": "98402",
              "lat": 47.2529, "lng": -122.4443},
  "hours": {"mon": [{"open": "07:00", "close": "15:00"}], "fri": [{"open": "18:00", "close": "01:00"}]},
  "googlePlaceId": "ChIJHarborRoast0001", "phone": "+1 253-555-0142",
  "website": "https://harbor-roast.example.com/"
}');
insert into test_places (key, location)
select variant.key, google.location || variant.change
from test_places google
cross join (values
  ('by-hand', '{"googlePlaceId": null, "phone": null, "website": null, "address": {"city": "Tacoma"}}'::jsonb),
  ('bad-lat', '{"address": {"lat": 91, "lng": -122.4443}}'),
  ('bad-lng', '{"address": {"lat": 47.2529, "lng": -181}}'),
  ('half-pin', '{"address": {"lat": 47.2529}}'),
  ('text-pin', '{"address": {"lat": "47.2529", "lng": "-122.4443"}}'),
  ('bad-place', '{"googlePlaceId": "not a place id"}'),
  ('bad-phone', '{"phone": "call the front desk"}'),
  ('http-site', '{"website": "http://harbor-roast.example.com/"}'),
  ('moved-place', '{"googlePlaceId": "ChIJHarborRoast0002"}')
) as variant(key, change)
where google.key = 'google';
-- A caller from before this migration sends none of the new keys at all.
insert into test_places (key, location)
select 'older-caller', (location - 'googlePlaceId' - 'phone' - 'website') || '{"address": {"city": "Tacoma"}}'
from test_places where key = 'google';
grant select on test_places to authenticated;

-- One independent coffee shop per call, named after its handle.
create function pg_temp.provision(p_key uuid, p_slug text, p_place text) returns jsonb
language sql as $$
  select public.provision_platform_organization_with_connectors(
    p_key, initcap(replace(p_slug, '-', ' ')), p_slug,
    '72727272-7272-4272-8272-727272727272', 'places-owner@example.test',
    'independent', 'coffee-shop', 'coffee-shop', '{}',
    (select location from test_places where key = p_place), '[]', null, '{}', '{}', '[]')
$$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '71717171-7171-4171-8171-717171717171', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'platform_admin',
    'brand_id', '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', 'location_ids', jsonb_build_array())
)::text, true);
select set_config('request.jwt.claim.sub', '71717171-7171-4171-8171-717171717171', true);

select lives_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000001', 'harbor-roast-places', 'google') $q$,
  'an organization provisions with what Google filled in');
select lives_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000002', 'by-hand-places', 'by-hand') $q$,
  'a location typed by hand provisions with none of them');
select lives_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000003', 'older-caller-places', 'older-caller') $q$,
  'a caller that sends none of the new keys still provisions');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000004', 'refused-bad-lat', 'bad-lat') $q$,
  '22023', 'invalid_first_location', 'a latitude past 90 is refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000005', 'refused-bad-lng', 'bad-lng') $q$,
  '22023', 'invalid_first_location', 'a longitude past -180 is refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000006', 'refused-half-pin', 'half-pin') $q$,
  '22023', 'invalid_first_location', 'a latitude without its longitude is refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000007', 'refused-text-pin', 'text-pin') $q$,
  '22023', 'invalid_first_location', 'coordinates written as text are refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000008', 'refused-bad-place', 'bad-place') $q$,
  '22023', 'invalid_first_location', 'a Place id in the wrong shape is refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000009', 'refused-bad-phone', 'bad-phone') $q$,
  '22023', 'invalid_first_location', 'a phone nobody can dial is refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-00000000000a', 'refused-http-site', 'http-site') $q$,
  '22023', 'invalid_first_location', 'a website that is not https is refused');
select throws_ok($q$ select pg_temp.provision('7b7b7b7b-0000-4000-8000-000000000001', 'harbor-roast-places', 'moved-place') $q$,
  '22023', 'idempotency_key_payload_mismatch', 'a replay naming a different Place is refused');
reset role;

select is((select location.google_place_id from public.locations location
  join public.brands brand on brand.id = location.brand_id where brand.slug = 'harbor-roast-places'),
  'ChIJHarborRoast0001', 'the location keeps the Google Place it is');
select is((select location.phone from public.locations location
  join public.brands brand on brand.id = location.brand_id where brand.slug = 'harbor-roast-places'),
  '+1 253-555-0142', 'the location keeps its phone');
select is((select location.website from public.locations location
  join public.brands brand on brand.id = location.brand_id where brand.slug = 'harbor-roast-places'),
  'https://harbor-roast.example.com/', 'the location keeps its website');
select is((select jsonb_build_array(location.address->'lat', location.address->'lng') from public.locations location
  join public.brands brand on brand.id = location.brand_id where brand.slug = 'harbor-roast-places'),
  '[47.2529, -122.4443]'::jsonb, 'the map pin stays with the address');
select is((select count(*) from public.locations location
  join public.brands brand on brand.id = location.brand_id
  where brand.slug in ('by-hand-places', 'older-caller-places')
    and location.google_place_id is null and location.phone is null and location.website is null
    and location.address->'lat' is null and location.address->'lng' is null),
  2::bigint, 'a location typed by hand, or sent by an older caller, stores none of them');
select is((select count(*) from public.brands where slug like 'refused-%'),
  0::bigint, 'a refused first location leaves no organization behind');

-- The columns hold every writer to the same rules, not only provisioning.
select throws_ok($q$ update public.locations set phone = 'call the front desk'
  where brand_id = (select id from public.brands where slug = 'by-hand-places') $q$,
  '23514', null, 'the phone column refuses a number nobody can dial');
select throws_ok($q$ update public.locations set website = 'http://harbor-roast.example.com/'
  where brand_id = (select id from public.brands where slug = 'by-hand-places') $q$,
  '23514', null, 'the website column refuses an address that is not https');

select lives_ok($q$ select app.assert_location_place_fields() $q$,
  'the release assertion holds on the migrated schema');

select * from finish();
rollback;
