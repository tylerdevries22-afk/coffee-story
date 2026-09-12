-- Three Square payment-validation RPCs were reachable without signing in.
--
-- 20260908227000 created them with a bare `create function`, and PostgreSQL
-- grants EXECUTE to PUBLIC by default, so PostgREST published all three at
-- /rest/v1/rpc/ for the anon role. The same migration revokes
-- count_square_payment_remediation_alerts ten lines above these -- same author,
-- same file, same pattern -- which is what makes this an omission rather than a
-- decision.
--
-- What it exposed, confirmed against the live database before this was written:
--   count_square_payment_validation_alerts   how many payment checks are failing
--   record_square_payment_validation_alert   inject an alert for a known event
--   resolve_square_payment_validation_alert  mark a real alert resolved
--
-- The third is the one that matters. These alerts exist to catch fee, amount,
-- settlement and order-binding mismatches; an unauthenticated caller who knows
-- a Square event id could close one with an arbitrary resolution code and
-- evidence reference, and the anomaly stops being visible to anyone. Knowing an
-- event id is the only barrier, and an event id is not a secret.
--
-- These are service-role operations. The webhook path already calls them with
-- the service key; nothing client-side has any business reaching them.

revoke all on function public.count_square_payment_validation_alerts()
  from public, anon, authenticated, service_role;
grant execute on function public.count_square_payment_validation_alerts()
  to service_role;
revoke all on function public.record_square_payment_validation_alert(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_square_payment_validation_alert(text, text)
  to service_role;
revoke all on function public.resolve_square_payment_validation_alert(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_square_payment_validation_alert(text, text, text)
  to service_role;

create or replace function app.assert_square_validation_alerts_unexposed()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.count_square_payment_validation_alerts()',
    'public.record_square_payment_validation_alert(text,text)',
    'public.resolve_square_payment_validation_alert(text,text,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'square payment validation RPC is missing: %', v_signature;
    end if;
    -- The exposure this migration closed: a definer function that suppresses a
    -- payment anomaly must never be callable by an unauthenticated request.
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'square payment validation RPC is client reachable: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'square payment validation RPC is unavailable to the webhook path: %', v_signature;
    end if;
  end loop;
end $$;

revoke all on function app.assert_square_validation_alerts_unexposed()
  from public, anon, authenticated;
grant execute on function app.assert_square_validation_alerts_unexposed()
  to service_role;

select app.register_release(
  '20260912010000',
  'square payment validation alert RPCs are service-role only',
  'app.assert_square_validation_alerts_unexposed()'::regprocedure
);
