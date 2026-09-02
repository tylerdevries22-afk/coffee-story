-- Advisor remediation for the franchise foundations: RLS init-plan and one
-- duplicate index.
--
-- Four policies called auth.uid() bare, so Postgres re-evaluated it per row.
-- The Supabase advisor fails the hosted gate at warn; wrapping the call in a
-- one-row scalar subselect lets the planner hoist it to an init plan. The
-- policies are recreated verbatim otherwise -- same tables, same rules, same
-- helper functions.
--
-- locations_id_brand_device_wall_idx duplicated the pre-existing
-- locations_id_brand_key (both are unique on (id, brand_id)). The duplicate
-- buys nothing and every write pays for it, so the device-wall copy goes.

drop policy franchise_networks_select on public.franchise_networks;
create policy franchise_networks_select on public.franchise_networks
  for select to authenticated
  using (app.is_franchise_network_member(id, (select auth.uid())));

drop policy franchise_memberships_select on public.franchise_memberships;
create policy franchise_memberships_select on public.franchise_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.is_franchise_network_admin(network_id, (select auth.uid()))
  );

drop policy franchise_network_brands_select on public.franchise_network_brands;
create policy franchise_network_brands_select on public.franchise_network_brands
  for select to authenticated
  using (app.is_franchise_network_member(network_id, (select auth.uid())));

drop policy delegated_access_grants_select on public.delegated_access_grants;
create policy delegated_access_grants_select on public.delegated_access_grants
  for select to authenticated
  using (grantee_user_id = (select auth.uid()) or app.is_brand_owner(brand_id));

drop index if exists public.locations_id_brand_device_wall_idx;

-- Readiness chain: this link asserts its predecessor, which transitively
-- re-runs the FK-coverage check. The two spot assertions pin what the
-- advisors named so a future edit cannot restore either defect quietly.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902124238;
alter function public.platform_release_readiness_20260902124238() set schema app;
revoke all on function app.platform_release_readiness_20260902124238()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902124238() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902124238() <> '20260902124238' then
    raise exception 'foreign key index readiness prerequisite is incomplete';
  end if;
  if exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'locations_id_brand_device_wall_idx'
  ) then raise exception 'duplicate locations index restored'; end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'franchise_networks'
      and policyname = 'franchise_networks_select'
      and qual ~* '\(\s*select\s+auth\.uid\(\))'
  ) then raise exception 'franchise network policy lost its init-plan hoist'; end if;
  return '20260902144208';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
