-- The parent analytics_events policy protects normal partition-routed access,
-- but direct child-table access should also fail closed without producing an
-- RLS-without-policy advisor finding. Only the service role can touch raw data.

do $$
declare
  child record;
begin
  for child in
    select child_namespace.nspname as schema_name, child_class.relname as table_name
      from pg_inherits inheritance
      join pg_class parent_class on parent_class.oid = inheritance.inhparent
      join pg_namespace parent_namespace on parent_namespace.oid = parent_class.relnamespace
      join pg_class child_class on child_class.oid = inheritance.inhrelid
      join pg_namespace child_namespace on child_namespace.oid = child_class.relnamespace
     where parent_namespace.nspname = 'public'
       and parent_class.relname = 'analytics_events'
  loop
    if not exists (
      select 1 from pg_policies policy
       where policy.schemaname = child.schema_name
         and policy.tablename = child.table_name
         and policy.policyname = 'analytics_events_service'
    ) then
      execute format(
        'create policy analytics_events_service on %I.%I for all to service_role using (true) with check (true)',
        child.schema_name,
        child.table_name
      );
    end if;
  end loop;
end $$;
