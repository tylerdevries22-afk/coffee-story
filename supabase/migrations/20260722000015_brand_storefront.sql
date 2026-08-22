-- 0015: the anonymous storefront's view of a brand.
--
-- brands_select requires a brand claim (or platform admin), so an anonymous
-- guest booting the customer app could not read the row that carries the
-- theme tokens, copy, and feature flags it renders with — the data-reads
-- integration test caught fetchBrandBySlug returning null. The row itself
-- must stay claim-gated: it also carries fee_bps / fee_bps_tier2 /
-- tier_threshold_cents, the platform's commercial terms with the brand.
--
-- Same pattern as location_square_status (0008): an owner view over the
-- protected table, exposing only storefront-safe columns, world-readable.
create view public.brand_storefront with (security_barrier) as
  select
    b.id,
    b.slug,
    b.name,
    b.drops,
    b.catering,
    b.delivery,
    b.multi_location,
    b.sms,
    b.stored_value,
    b.referrals,
    b.brand_config
  from public.brands b;

grant select on public.brand_storefront to anon, authenticated;
