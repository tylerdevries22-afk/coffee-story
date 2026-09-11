-- Tables that had RLS enabled with zero policies (fail-closed only while unGRANTed).
-- Add explicit deny policies so a future GRANT cannot accidentally open PostgREST.

do $$
declare
  target text;
  tables text[] := array[
    'device_stream_sessions',
    'device_wall_enrollment_codes',
    'operation_action_receipts',
    'operation_notification_outbox',
    'platform_billing_webhook_events',
    'platform_factory_audit_events'
  ];
begin
  foreach target in array tables loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists %I on public.%I', target || '_deny_all', target);
    execute format(
      'create policy %I on public.%I for all to authenticated, anon using (false) with check (false)',
      target || '_deny_all', target
    );
  end loop;
end $$;

create or replace function app.assert_empty_policy_tables_denied()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  missing integer;
begin
  select count(*)::integer into missing
    from unnest(array[
      'device_stream_sessions','device_wall_enrollment_codes','operation_action_receipts',
      'operation_notification_outbox','platform_billing_webhook_events','platform_factory_audit_events'
    ]) as t(name)
    where not exists (
      select 1 from pg_catalog.pg_policies policy
      where policy.schemaname = 'public' and policy.tablename = t.name
        and policy.policyname = t.name || '_deny_all'
    );
  if missing > 0 then
    raise exception 'deny-all policies missing on % empty-RLS tables', missing;
  end if;
end $$;

revoke all on function app.assert_empty_policy_tables_denied()
  from public, anon, authenticated;
grant execute on function app.assert_empty_policy_tables_denied() to service_role;

select app.register_release(
  '20260911160000',
  'explicit deny-all RLS on formerly empty-policy tables',
  'app.assert_empty_policy_tables_denied()'::regprocedure
);
