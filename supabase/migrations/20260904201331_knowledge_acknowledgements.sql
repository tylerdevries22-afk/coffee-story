-- Knowledge acknowledgements are versioned facts, not mutable catalog metadata.
-- The caller-facing function derives both tenant and user from the verified
-- session, then records one immutable row per resource version.

alter table public.catalog_resources
  add constraint catalog_resources_id_brand_key unique (id, brand_id);

create table public.knowledge_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete restrict,
  resource_id uuid not null,
  user_id uuid not null,
  resource_version text not null
    check (length(btrim(resource_version)) between 1 and 40),
  acknowledged_at timestamptz not null default now(),
  unique (brand_id, resource_id, user_id, resource_version),
  foreign key (resource_id, brand_id)
    references public.catalog_resources (id, brand_id) on delete restrict,
  foreign key (user_id, brand_id)
    references public.brand_users (user_id, brand_id) on delete restrict
);

create index knowledge_acknowledgements_user_idx
  on public.knowledge_acknowledgements (user_id, brand_id, acknowledged_at desc);

create trigger knowledge_acknowledgements_append_only
before update or delete on public.knowledge_acknowledgements
for each row execute function app.reject_record_mutation();

-- This helper is called by the catalog-resource read policy and the write RPC.
-- SECURITY DEFINER is limited to the non-exposed app schema; it returns only a
-- boolean and always resolves membership from auth.uid().
create or replace function app.can_read_knowledge_resource(
  target_brand uuid,
  target_kind text,
  target_audience text,
  target_metadata jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  member_id uuid;
  member_role app.brand_role;
  member_locations uuid[];
  knowledge jsonb := target_metadata -> 'knowledge';
  location_targets text[];
  role_targets text[];
  location_allowed boolean;
  role_allowed boolean;
begin
  if caller is null or not app.is_brand_staff(target_brand) then
    return false;
  end if;

  select member.id, member.role, member.location_ids
    into member_id, member_role, member_locations
  from public.brand_users member
  where member.brand_id = target_brand
    and member.user_id = caller;
  if not found then return false; end if;

  if target_kind not in ('knowledge', 'procedure', 'specification')
     or knowledge ->> 'status' is distinct from 'approved' then
    return false;
  end if;
  if member_role <> 'brand_owner'
     and target_audience not in ('public', 'staff')
     and not (target_audience = 'manager' and member_role = 'location_manager') then
    return false;
  end if;

  select coalesce(pg_catalog.array_agg(target.value), '{}'::text[])
    into location_targets
  from pg_catalog.jsonb_array_elements_text(
    case when pg_catalog.jsonb_typeof(knowledge -> 'locationIds') = 'array'
      then knowledge -> 'locationIds' else '[]'::jsonb end
  ) target(value);
  location_allowed := member_role = 'brand_owner'
    or pg_catalog.cardinality(location_targets) = 0
    or exists (
      select 1 from pg_catalog.unnest(member_locations) location_id
      where location_id::text = any (location_targets)
    );
  if not location_allowed then return false; end if;

  select coalesce(pg_catalog.array_agg(pg_catalog.lower(target.value)), '{}'::text[])
    into role_targets
  from pg_catalog.jsonb_array_elements_text(
    case when pg_catalog.jsonb_typeof(knowledge -> 'roleTargets') = 'array'
      then knowledge -> 'roleTargets' else '[]'::jsonb end
  ) target(value);
  role_allowed := pg_catalog.cardinality(role_targets) = 0
    or pg_catalog.lower(member_role::text) = any (role_targets)
    or exists (
      select 1
      from public.workforce_role_assignments assignment
      join public.workforce_roles workforce_role
        on workforce_role.id = assignment.workforce_role_id
       and workforce_role.brand_id = assignment.brand_id
      where assignment.brand_id = target_brand
        and assignment.brand_user_id = member_id
        and workforce_role.is_active
        and (pg_catalog.lower(workforce_role.name) = any (role_targets)
          or pg_catalog.lower(workforce_role.slug) = any (role_targets))
        and (assignment.location_id is null
          or pg_catalog.cardinality(location_targets) = 0
          or assignment.location_id::text = any (location_targets))
    );
  return role_allowed;
end $$;

revoke all on function app.can_read_knowledge_resource(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function app.can_read_knowledge_resource(uuid, text, text, jsonb)
  to authenticated, service_role;

drop policy catalog_resources_owner on public.catalog_resources;
create policy catalog_resources_read on public.catalog_resources for select to authenticated
  using (
    app.is_brand_owner(brand_id)
    or app.can_read_knowledge_resource(brand_id, kind, audience, metadata)
  );
create policy catalog_resources_owner_insert on public.catalog_resources for insert to authenticated
  with check (app.is_brand_owner(brand_id));
create policy catalog_resources_owner_update on public.catalog_resources for update to authenticated
  using (app.is_brand_owner(brand_id))
  with check (app.is_brand_owner(brand_id));

alter table public.knowledge_acknowledgements enable row level security;
create policy knowledge_acknowledgements_read on public.knowledge_acknowledgements
  for select to authenticated
  using (
    app.is_brand_owner(brand_id)
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.catalog_resources resource
        where resource.id = knowledge_acknowledgements.resource_id
          and resource.brand_id = knowledge_acknowledgements.brand_id
      )
    )
  );

revoke all on table public.knowledge_acknowledgements from public, anon, authenticated;
grant select on table public.knowledge_acknowledgements to authenticated;
grant select, insert on table public.knowledge_acknowledgements to service_role;

-- Preserve any prototype-era acknowledgements that point at real members,
-- then permanently remove the metadata array from the live write model.
insert into public.knowledge_acknowledgements (
  brand_id, resource_id, user_id, resource_version, acknowledged_at
)
select resource.brand_id,
  resource.id,
  member.user_id,
  coalesce(nullif(btrim(resource.metadata #>> '{knowledge,version}'), ''), '1.0'),
  resource.updated_at
from public.catalog_resources resource
cross join lateral pg_catalog.jsonb_array_elements_text(
  case
    when pg_catalog.jsonb_typeof(resource.metadata #> '{knowledge,acknowledgedUserIds}') = 'array'
      then resource.metadata #> '{knowledge,acknowledgedUserIds}'
    else '[]'::jsonb
  end
) acknowledged(user_id)
join public.brand_users member
  on member.brand_id = resource.brand_id
 and member.user_id = case
   when acknowledged.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     then acknowledged.user_id::uuid
   else null
 end
on conflict (brand_id, resource_id, user_id, resource_version) do nothing;

update public.catalog_resources
set metadata = metadata #- '{knowledge,acknowledgedUserIds}'::text[]
where metadata #> '{knowledge,acknowledgedUserIds}' is not null;

alter table public.catalog_resources
  add constraint catalog_resources_no_embedded_acknowledgements
  check (metadata #> '{knowledge,acknowledgedUserIds}' is null);

create or replace function public.acknowledge_knowledge_resource(p_resource_id uuid)
returns table (
  acknowledged_resource_id uuid,
  acknowledged_version text,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  resource record;
  version text;
begin
  if caller is null then
    raise exception using errcode = '42501', message = 'knowledge_access_denied';
  end if;
  select item.id, item.brand_id, item.kind, item.audience, item.metadata
    into resource
  from public.catalog_resources item
  where item.id = p_resource_id
    and item.archived_at is null;
  if not found or not app.can_read_knowledge_resource(
    resource.brand_id, resource.kind, resource.audience, resource.metadata
  ) then
    raise exception using errcode = '42501', message = 'knowledge_access_denied';
  end if;
  version := btrim(resource.metadata #>> '{knowledge,version}');
  if version is null or version = '' then
    raise exception using errcode = '22023', message = 'knowledge_version_required';
  end if;

  insert into public.knowledge_acknowledgements (
    brand_id, resource_id, user_id, resource_version
  ) values (resource.brand_id, resource.id, caller, version)
  on conflict (brand_id, resource_id, user_id, resource_version) do nothing;

  return query
  select acknowledgement.resource_id,
    acknowledgement.resource_version,
    acknowledgement.acknowledged_at
  from public.knowledge_acknowledgements acknowledgement
  where acknowledgement.brand_id = resource.brand_id
    and acknowledgement.resource_id = resource.id
    and acknowledgement.user_id = caller
    and acknowledgement.resource_version = version;
end $$;

revoke all on function public.acknowledge_knowledge_resource(uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_knowledge_resource(uuid)
  to authenticated, service_role;

create or replace function app.assert_knowledge_acknowledgements()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regclass('public.knowledge_acknowledgements') is null then
    raise exception 'knowledge acknowledgement ledger is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.knowledge_acknowledgements'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'knowledge acknowledgement RLS is disabled';
  end if;
  if not pg_catalog.has_table_privilege(
       'authenticated', 'public.knowledge_acknowledgements', 'select')
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.knowledge_acknowledgements', 'insert,update,delete')
     or pg_catalog.has_table_privilege(
       'anon', 'public.knowledge_acknowledgements', 'select,insert,update,delete') then
    raise exception 'knowledge acknowledgement table grants are unsafe';
  end if;
  if pg_catalog.to_regprocedure('public.acknowledge_knowledge_resource(uuid)') is null
     or not pg_catalog.has_function_privilege(
       'authenticated', 'public.acknowledge_knowledge_resource(uuid)', 'execute')
     or pg_catalog.has_function_privilege(
       'anon', 'public.acknowledge_knowledge_resource(uuid)', 'execute') then
    raise exception 'knowledge acknowledgement RPC grants are unsafe';
  end if;
  if exists (
    select 1 from public.catalog_resources
    where metadata #> '{knowledge,acknowledgedUserIds}' is not null
  ) then
    raise exception 'knowledge acknowledgements remain embedded in catalog metadata';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.knowledge_acknowledgements'::regclass
      and trigger_row.tgname = 'knowledge_acknowledgements_append_only'
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'knowledge acknowledgement append-only guard is missing';
  end if;
end $$;

revoke all on function app.assert_knowledge_acknowledgements()
  from public, anon, authenticated;
grant execute on function app.assert_knowledge_acknowledgements() to service_role;

select app.register_release(
  '20260904201331',
  'knowledge reads are targeted, acknowledgement identity is caller-derived, and the versioned ledger is append-only',
  'app.assert_knowledge_acknowledgements()'::regprocedure
);
