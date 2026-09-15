-- One permissive SELECT policy on integration_brand_enrollments, and write
-- denial that actually denies.
--
-- 20260914120000 paired a permissive SELECT policy with a second policy
-- declared `for all ... using (false)` as belt and braces. Two problems, both
-- found by the hosted performance advisor failing the promotion:
--
-- 1. `for all` includes SELECT, so role `authenticated` had two permissive
--    policies for the same action. That is the advisor's
--    multiple_permissive_policies warning, and the hosted job runs advisors
--    with --fail-on warn, so it reddened every push to main.
--
-- 2. The belt was not a belt. Permissive policies combine with OR, so a
--    permissive `using (false)` adds nothing to a SELECT that another
--    permissive policy already allows -- and it cannot protect a write from a
--    future permissive policy either, for exactly the same reason. It read as
--    a guarantee while providing none.
--
-- Writes were already denied: RLS is on and no permissive policy names INSERT,
-- UPDATE or DELETE, so those commands fail regardless of any grant. What is
-- added here is the guarantee the original comment was reaching for, in the
-- form that actually holds it -- RESTRICTIVE policies, which AND with every
-- permissive policy and so survive someone later adding a broad one.

drop policy if exists integration_brand_enrollments_deny_write
  on public.integration_brand_enrollments;

create policy integration_brand_enrollments_no_insert
  on public.integration_brand_enrollments
  as restrictive for insert to authenticated, anon
  with check (false);

create policy integration_brand_enrollments_no_update
  on public.integration_brand_enrollments
  as restrictive for update to authenticated, anon
  using (false) with check (false);

create policy integration_brand_enrollments_no_delete
  on public.integration_brand_enrollments
  as restrictive for delete to authenticated, anon
  using (false);

create or replace function app.assert_enrollment_policy_shape()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  permissive_selects integer;
  restrictive_writes integer;
begin
  -- The regression this exists to catch: a second permissive policy covering
  -- SELECT for the same role. `all` counts, because that is how the first one
  -- got here.
  select count(*) into permissive_selects
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'integration_brand_enrollments'
    and permissive = 'PERMISSIVE'
    and cmd in ('SELECT', 'ALL')
    and 'authenticated'::name = any (roles);

  if permissive_selects <> 1 then
    raise exception
      'integration_brand_enrollments must have exactly one permissive SELECT policy for authenticated, found %',
      permissive_selects;
  end if;

  -- And the write denial must be restrictive, or it denies nothing.
  select count(*) into restrictive_writes
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'integration_brand_enrollments'
    and permissive = 'RESTRICTIVE'
    and cmd in ('INSERT', 'UPDATE', 'DELETE');

  if restrictive_writes <> 3 then
    raise exception
      'integration_brand_enrollments must restrict insert, update and delete, found % restrictive write policies',
      restrictive_writes;
  end if;

  if has_table_privilege('authenticated', 'public.integration_brand_enrollments', 'insert')
    or has_table_privilege('anon', 'public.integration_brand_enrollments', 'insert') then
    raise exception 'a client role can write integration_brand_enrollments';
  end if;
end $$;

revoke all on function app.assert_enrollment_policy_shape()
  from public, anon, authenticated;
grant execute on function app.assert_enrollment_policy_shape() to service_role;

select app.register_release(
  '20260914130000',
  'integration_brand_enrollments has exactly one permissive SELECT policy, and its write denial is restrictive so it survives a future permissive policy',
  'app.assert_enrollment_policy_shape()'::regprocedure
);
