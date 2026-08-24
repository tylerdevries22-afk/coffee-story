-- 0039: a franchise does not have one fee schedule.
--
-- Rule 3 puts the platform's take on the BRAND: `fee_bps`, `fee_bps_tier2`,
-- `tier_threshold_cents`. That is right for a single shop and for a chain the
-- brand owns outright, and it is the wrong shape the moment the same brand
-- carries franchisees -- which is the case this platform is being pointed at.
--
-- Franchise terms are negotiated per franchisee: a flagship that signed early
-- on 300bps sits under the same brand as one that came in at 250, and a
-- location trialling the platform may sit at zero for a quarter. With the rate
-- on the brand, the only way to express that is a second brand -- which splits
-- the menu, the loyalty ladder and the guest's account along a line that
-- exists purely for billing.
--
-- So: nullable overrides on the location. NULL means "inherit the brand",
-- which is what every existing row means today and why this migration needs no
-- backfill. A location sets only the fields it negotiated; the rest still
-- follow the brand, so a franchisee on a different rate still moves with the
-- brand when the volume threshold changes.

alter table public.locations
  add column fee_bps integer check (fee_bps between 0 and 10000),
  add column fee_bps_tier2 integer check (fee_bps_tier2 between 0 and 10000),
  add column tier_threshold_cents bigint check (tier_threshold_cents >= 0);

comment on column public.locations.fee_bps is
  'Per-location override of brands.fee_bps. NULL inherits the brand.';
comment on column public.locations.fee_bps_tier2 is
  'Per-location override of brands.fee_bps_tier2. NULL inherits the brand.';
comment on column public.locations.tier_threshold_cents is
  'Per-location override of brands.tier_threshold_cents. NULL inherits the brand.';

-- ---------------------------------------------------------------------------
-- Who may set them
--
-- `locations_update` (0007) admits `app.at_location`, which includes a
-- `location_manager` -- a franchisee. A franchisee editing their own
-- commission is the one write on this table that must not be theirs, so it is
-- a trigger rather than a policy: policies cannot compare OLD and NEW, and
-- this has to refuse a CHANGE rather than a value. Same shape as 0031's
-- platform_admin guard, for the same reason.
--
-- The service role carries no jwt role, so the engine and the onboarding
-- script stay free to set terms.
create or replace function app.protect_location_fee_terms() returns trigger
language plpgsql as $$
begin
  if (new.fee_bps is distinct from old.fee_bps
      or new.fee_bps_tier2 is distinct from old.fee_bps_tier2
      or new.tier_threshold_cents is distinct from old.tier_threshold_cents)
     and app.jwt_role() is distinct from 'platform_admin'
     and app.jwt_role() is not null
  then
    raise exception 'only the platform operator may change a location''s fee terms';
  end if;
  return new;
end $$;

drop trigger if exists locations_protect_fee_terms on public.locations;
create trigger locations_protect_fee_terms
  before update on public.locations
  for each row execute function app.protect_location_fee_terms();

-- ---------------------------------------------------------------------------
-- What the platform bills against
--
-- `platform_fees.fee_bps_applied` already records the rate each payment was
-- charged at, so the ledger stays truthful across a terms change without any
-- backfill: rows written before a renegotiation keep the old number, which is
-- exactly what a franchisee disputing an invoice needs to see.
