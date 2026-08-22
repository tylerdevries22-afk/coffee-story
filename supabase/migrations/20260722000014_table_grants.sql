-- 0014: table privileges. On this stack, tables created by the migration role
-- carry no automatic grants for the client roles, so RLS never even got to
-- answer -- queries died earlier with "permission denied for table". The
-- integration run proved it, and worse: two policy-denial tests were passing
-- for the wrong reason (privilege denial, not policy denial).
--
-- The Supabase convention is deliberate: coarse table grants to the client
-- roles, with RLS as the actual gate. Tables that must stay service-only
-- (square_connections, platform_fees, webhook_events, push_tokens) are
-- protected by having no policies -- RLS on + zero policies denies every
-- client query regardless of these grants.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to authenticated, service_role;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- Future tables created by the migration role inherit the same shape.
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
