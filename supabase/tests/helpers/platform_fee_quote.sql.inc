create function pg_temp.test_claim_platform_fee_quote(
  p_order_id uuid, p_location_id uuid, p_charge_cents bigint,
  p_fee_bps integer, p_fee_bps_tier2 integer, p_tier_threshold_cents bigint,
  p_month_start timestamptz, p_month_end timestamptz,
  p_require_existing boolean default false
)
returns table (
  quoted_fee_cents bigint, quoted_fee_bps_applied integer,
  quote_claim_generation uuid, quote_claim_created boolean
)
language sql as $$
  select claimed.*
  from public.square_connections connection
  cross join lateral public.claim_platform_fee_quote(
    p_order_id, p_location_id, p_charge_cents, p_fee_bps, p_fee_bps_tier2,
    p_tier_threshold_cents, p_month_start, p_month_end,
    connection.id, connection.connection_generation, p_require_existing
  ) claimed
  where connection.location_id = p_location_id
$$;
