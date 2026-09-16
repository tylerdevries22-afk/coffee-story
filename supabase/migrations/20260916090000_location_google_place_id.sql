-- A location can name the Google Place it IS.
--
-- `locations.address` is a free-form jsonb bag of street/city/region/postal.
-- That describes where a venue is; it does not identify which venue it is. Two
-- hotels on the same block share a city and a postal code, chains repeat a name
-- across hundreds of properties, and neither an address nor a name survives a
-- re-sync as a stable key. A Place id does, which is what lets a partner
-- describe ANY venue -- any chain, any independent -- instead of a hand-listed
-- few, and lets a second push recognise the property it already sent.
--
-- A column rather than another jsonb field, because identity is the thing you
-- constrain and query: the partial unique index below is the point of it.
-- Actz models the same fact the same way (provider_locations.google_place_id).
--
-- Nullable, and no backfill: every location that exists today was authored
-- without a Places lookup, and inventing an id for one would be a fabricated
-- identity rather than a missing one.

alter table public.locations
  add column google_place_id text
    constraint locations_google_place_id_is_opaque_id
    check (
      google_place_id is null
      or google_place_id ~ '^[A-Za-z0-9_-]{6,255}$'
    );

comment on column public.locations.google_place_id is
  'The Google Place this location is, when a partner resolved one. Opaque; '
  'never parsed for meaning. Unique per brand so one property cannot be '
  'claimed twice inside a tenant.';

-- Scoped to the brand, not global: two different tenants may legitimately both
-- operate at one Place -- a hotel chain and the spa concession inside its
-- lobby are separate brands at the same address. What must never happen is one
-- tenant holding the same property twice, which is how a pack that re-pushes
-- with a changed name silently doubles a location instead of updating it.
create unique index locations_brand_google_place_id_key
  on public.locations (brand_id, google_place_id)
  where google_place_id is not null;

-- Release readiness: the column is only worth having while the constraint and
-- the per-brand uniqueness both stand. A column that lost its unique index is
-- worse than no column, because callers would still treat it as an identity.
create or replace function app.assert_location_google_place_id()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.locations'::regclass
      and attribute.attname = 'google_place_id'
      and not attribute.attisdropped
  ) then
    raise exception 'locations lost its google_place_id column';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.locations'::regclass
      and constraint_row.conname = 'locations_google_place_id_is_opaque_id'
  ) then
    raise exception 'google_place_id no longer constrains its charset';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'public' and index_row.tablename = 'locations'
      and index_row.indexname = 'locations_brand_google_place_id_key'
  ) then
    raise exception 'a brand may now hold one Google Place twice';
  end if;
end
$$;

revoke all on function app.assert_location_google_place_id()
  from public, anon, authenticated;
grant execute on function app.assert_location_google_place_id() to service_role;

select app.register_release(
  '20260916090000',
  'a location may carry the Google Place it is, unique within its brand',
  'app.assert_location_google_place_id()'::regprocedure
);
