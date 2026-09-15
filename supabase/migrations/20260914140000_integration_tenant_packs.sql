-- Validated tenant-pack snapshots received from Elevate after a successful
-- repository materialization. The endpoint validates the pack shape; this
-- migration makes authorization and revision ordering database invariants.

create table public.integration_tenant_packs (
  brand_id uuid not null references public.brands (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
  revision integer not null check (revision >= 1),
  files jsonb not null check (jsonb_typeof(files) = 'object'),
  source_repo text not null
    check (source_repo ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  received_by uuid references auth.users (id) on delete set null,
  received_at timestamptz not null default now(),
  primary key (brand_id, slug)
);

-- Both foreign keys must be indexed independently. The repository-wide
-- foreign-key assertion checks every public foreign key during readiness.
create index integration_tenant_packs_brand_idx
  on public.integration_tenant_packs (brand_id);
create index integration_tenant_packs_received_by_idx
  on public.integration_tenant_packs (received_by);

alter table public.integration_tenant_packs enable row level security;
revoke all on public.integration_tenant_packs
  from public, anon, authenticated, service_role;

create policy integration_tenant_packs_deny_clients
  on public.integration_tenant_packs for all to anon, authenticated
  using (false) with check (false);

comment on table public.integration_tenant_packs is
  'Validated immutable-by-revision tenant-pack snapshots received from an enrolled Elevate integration.';

create or replace function public.receive_integration_tenant_pack(
  p_brand_id uuid,
  p_slug text,
  p_revision integer,
  p_files jsonb,
  p_source_repo text,
  p_source_commit text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  current_pack public.integration_tenant_packs%rowtype;
begin
  -- One denial for every authorization failure prevents brand enumeration.
  if caller is null or not exists (
    select 1 from public.brand_users membership
    where membership.user_id = caller
      and membership.brand_id = p_brand_id
      and membership.role = 'platform_admin'
  ) then
    raise exception using errcode = 'P0002', message = 'tenant_pack_denied';
  end if;
  if not exists (
    select 1 from public.integration_brand_enrollments enrollment
    where enrollment.brand_id = p_brand_id
      and enrollment.integration_key = 'elevate-tenant-pack'
      and enrollment.revoked_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'tenant_pack_denied';
  end if;

  if p_slug !~ '^[a-z][a-z0-9-]{1,62}$'
    or p_revision < 1
    or pg_catalog.jsonb_typeof(p_files) <> 'object'
    or p_source_repo !~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'
    or p_source_commit !~ '^[0-9a-f]{40}$' then
    raise exception using errcode = '22023', message = 'tenant_pack_invalid';
  end if;

  -- Serialize one brand/slug so equal-revision conflicts cannot race through.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':' || p_slug, 0)
  );
  select * into current_pack
  from public.integration_tenant_packs stored
  where stored.brand_id = p_brand_id and stored.slug = p_slug;

  if found and current_pack.revision > p_revision then
    raise exception using errcode = 'P0001', message = 'tenant_pack_stale_revision';
  end if;
  if found and current_pack.revision = p_revision then
    if current_pack.files = p_files
      and current_pack.source_repo = p_source_repo
      and current_pack.source_commit = p_source_commit then
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'tenant_pack_revision_conflict';
  end if;

  insert into public.integration_tenant_packs (
    brand_id, slug, revision, files, source_repo, source_commit, received_by
  ) values (
    p_brand_id, p_slug, p_revision, p_files, p_source_repo, p_source_commit, caller
  )
  on conflict (brand_id, slug) do update set
    revision = excluded.revision,
    files = excluded.files,
    source_repo = excluded.source_repo,
    source_commit = excluded.source_commit,
    received_by = excluded.received_by,
    received_at = now();
end
$$;

revoke all on function public.receive_integration_tenant_pack(
  uuid, text, integer, jsonb, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.receive_integration_tenant_pack(
  uuid, text, integer, jsonb, text, text
) to authenticated, service_role;

create or replace function app.assert_integration_tenant_packs()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  body text;
begin
  if pg_catalog.to_regclass('public.integration_tenant_packs') is null then
    raise exception 'integration_tenant_packs is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.integration_tenant_packs'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'integration_tenant_packs lost row level security';
  end if;
  if has_table_privilege('anon', 'public.integration_tenant_packs', 'select')
    or has_table_privilege('authenticated', 'public.integration_tenant_packs', 'select')
    or has_table_privilege('service_role', 'public.integration_tenant_packs', 'select') then
    raise exception 'integration_tenant_packs is directly readable';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'integration_tenant_packs'
      and indexname = 'integration_tenant_packs_brand_idx'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and tablename = 'integration_tenant_packs'
      and indexname = 'integration_tenant_packs_received_by_idx'
  ) then
    raise exception 'integration_tenant_packs foreign keys are not both indexed';
  end if;
  body := pg_catalog.pg_get_functiondef(
    'public.receive_integration_tenant_pack(uuid,text,integer,jsonb,text,text)'::regprocedure
  );
  if body !~ 'brand_users' or body !~ 'integration_brand_enrollments'
    or body !~ 'pg_advisory_xact_lock' then
    raise exception 'tenant-pack receipt lost authorization or revision serialization';
  end if;
end
$$;

revoke all on function app.assert_integration_tenant_packs()
  from public, anon, authenticated;
grant execute on function app.assert_integration_tenant_packs() to service_role;

select app.register_release(
  '20260914140000',
  'validated Elevate tenant packs are accepted only for live platform-admin memberships and live brand enrollments, with monotonic conflict-safe revisions',
  'app.assert_integration_tenant_packs()'::regprocedure
);
