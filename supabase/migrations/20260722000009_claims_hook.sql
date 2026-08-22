-- 0009: the claim minter. Every RLS policy in 0007 reads brand_id /
-- location_ids / role out of the JWT's app_metadata, and until this hook
-- nothing ever put them there: brand_users was written by no one and no
-- authenticated query could pass a single policy.
--
-- Supabase's Custom Access Token hook calls this for every token issued.
-- Resolution order:
--   1. brand_users row for the user      -> staff claims (role + locations)
--   2. customers row for the user        -> guest claims (brand only)
--   3. user_metadata.brand_slug          -> bootstrap: a fresh sign-up names
--      the brand its app binary is built for; validated against brands.slug.
--      A hostile guest can only self-assign a brand they could have signed
--      up for anyway, and every guest-readable row is further pinned to
--      user_id by the policies.
-- Multi-brand staff hold one brand_users row per brand; the earliest grant
-- wins here, and switching brands is a token refresh after the owner updates
-- rows (revisit if simultaneous multi-brand sessions are ever needed).

create or replace function app.custom_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  meta jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  uid uuid := (event ->> 'user_id')::uuid;
  staff record;
  guest record;
  bootstrap record;
  wanted_slug text;
begin
  select bu.brand_id, bu.role, bu.location_ids, b.name as brand_name
    into staff
    from public.brand_users bu
    join public.brands b on b.id = bu.brand_id
    where bu.user_id = uid
    order by bu.created_at
    limit 1;

  if found then
    meta := meta
      || jsonb_build_object(
        'brand_id', staff.brand_id,
        'role', staff.role,
        'location_ids', coalesce(to_jsonb(staff.location_ids), '[]'::jsonb),
        'brand_name', staff.brand_name);
  else
    select c.brand_id, b.name as brand_name
      into guest
      from public.customers c
      join public.brands b on b.id = c.brand_id
      where c.user_id = uid
      order by c.created_at
      limit 1;

    if found then
      meta := meta || jsonb_build_object('brand_id', guest.brand_id, 'brand_name', guest.brand_name);
    else
      -- Named to avoid colliding with brands.slug in the query below: an
      -- ambiguous reference raises at runtime and fails token issuance.
      wanted_slug := event -> 'claims' -> 'user_metadata' ->> 'brand_slug';
      if wanted_slug is not null then
        select b.id, b.name into bootstrap from public.brands b where b.slug = wanted_slug;
        if found then
          meta := meta || jsonb_build_object('brand_id', bootstrap.id, 'brand_name', bootstrap.name);
        end if;
      end if;
    end if;
  end if;

  claims := jsonb_set(claims, '{app_metadata}', meta);
  return jsonb_set(event, '{claims}', claims);
end $$;

-- The hook runs as supabase_auth_admin; nothing else may call it, and the
-- auth role needs to see the tables the resolver reads.
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token to supabase_auth_admin;
revoke execute on function app.custom_access_token from authenticated, anon, public;
grant select on public.brand_users, public.brands, public.customers to supabase_auth_admin;

-- 0001 created schema app but never granted usage, so every policy's call to
-- an app.* helper would fail for real client roles with "permission denied
-- for schema app" the moment RLS was actually exercised.
grant usage on schema app to authenticated, anon;
