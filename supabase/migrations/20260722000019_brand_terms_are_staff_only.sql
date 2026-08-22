-- 0019: the platform's commercial terms stop being readable by any guest.
--
-- brands_select returned the whole row to anyone whose token carried a
-- matching brand_id claim -- and a brand_id claim is not proof of anything.
-- The claims hook bootstraps one from `user_metadata.brand_slug`, which is
-- user-writable by design in Supabase: anyone holding the public anon key
-- can sign up (or call updateUser) naming any brand's slug, and slugs are
-- public. So any signed-up person could read fee_bps, fee_bps_tier2 and
-- tier_threshold_cents for every tenant on the platform -- exactly the
-- columns migration 0015 says must stay claim-gated, because they are the
-- platform's commercial terms with that brand.
--
-- Guests never needed the table. They read brand_storefront (0015), which
-- carries the identity, feature flags and brand_config a storefront needs
-- and deliberately omits the fee columns. The table itself is now staff
-- only: the operator app reads it under a staff claim, and the engine reads
-- it with the service role, which RLS does not apply to.
--
-- This does not make the bootstrap claim harmless in itself; it removes what
-- the claim was worth. A guest claim still grants only what every other
-- policy already pins to auth.uid().

drop policy brands_select on public.brands;

create policy brands_select on public.brands for select
  using (app.is_platform_admin() or app.is_brand_staff(id));
