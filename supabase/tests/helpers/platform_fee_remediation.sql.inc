create function pg_temp.test_finalize_square_payment_remediation(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_refund_id text,
  p_provider_refund_status text
)
returns boolean language sql as $$
  select public.finalize_square_payment_remediation(
    p_order_id, p_claim_generation, p_square_refund_id,
    p_provider_refund_status, queued.square_payment_id,
    queued.refund_amount_cents, 'USD'
  )
  from app_private.square_payment_remediation_outbox queued
  where queued.order_id = p_order_id
$$;
