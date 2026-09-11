-- Known failures remain retryable; ambiguous deliveries require reconciliation.
create or replace function public.claim_operation_notification_batch(target_limit integer default 50)
returns setof public.operation_notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  update public.operation_notification_outbox outbox
    set status = 'cancelled', last_error = 'operations_disabled'
  where not app.brand_operations_enabled(outbox.brand_id)
    and outbox.status in ('pending', 'failed', 'sending');

  -- A dead worker may have sent already. Keep the receipt for investigation;
  -- retrying an expired send lease cannot establish whether delivery happened.
  update public.operation_notification_outbox
    set status = 'cancelled', last_error = 'delivery_uncertain'
  where status = 'sending' and available_at <= now();

  return query with candidates as (
    select outbox.id from public.operation_notification_outbox outbox
    where outbox.status in ('pending', 'failed')
      and outbox.available_at <= now() and outbox.attempt_count < 20
      and app.brand_operations_enabled(outbox.brand_id)
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit least(greatest(target_limit, 1), 200)
  )
  update public.operation_notification_outbox outbox set status = 'sending',
    attempt_count = outbox.attempt_count + 1, last_error = null,
    available_at = now() + interval '5 minutes'
  from candidates where outbox.id = candidates.id returning outbox.*;
end
$$;
revoke all on function public.claim_operation_notification_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_operation_notification_batch(integer) to service_role;

select app.register_release('20260907223000', 'quarantine uncertain notification delivery');
