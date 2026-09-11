-- An access event may identify a file only when that file belongs to the
-- event's release and brand. Keep historical evidence intact: the NOT VALID
-- foreign key protects every new row immediately, and is validated when the
-- existing audit trail is already consistent.
alter table public.tenant_package_files
  add constraint tenant_package_files_access_identity_key
  unique (id, package_release_id, brand_id);

alter table public.tenant_package_access_events
  add constraint tenant_package_access_events_file_release_brand_fkey
  foreign key (file_id, package_release_id, brand_id)
  references public.tenant_package_files (id, package_release_id, brand_id)
  on delete restrict
  not valid;

alter table public.tenant_package_access_events
  add constraint tenant_package_access_events_action_file_check
  check (
    (action in ('preview', 'file_download') and file_id is not null)
    or (action in ('tree', 'archive_download', 'admin_override') and file_id is null)
  ) not valid;

create index tenant_package_access_events_file_release_brand_idx
  on public.tenant_package_access_events
  (file_id, package_release_id, brand_id);

-- Authenticated package readers receive metadata only for the release that is
-- currently published. Historical releases remain available to the
-- service-only rollback, retention, and audit paths.
drop policy tenant_package_releases_owner_admin_read
  on public.tenant_package_releases;
create policy tenant_package_releases_owner_admin_read
  on public.tenant_package_releases for select to authenticated
  using (
    app.can_read_tenant_package(brand_id)
    and exists (
      select 1
      from public.tenant_package_publications publication
      where publication.brand_id = tenant_package_releases.brand_id
        and publication.current_release_id = tenant_package_releases.id
    )
  );

drop policy tenant_package_files_owner_admin_read
  on public.tenant_package_files;
create policy tenant_package_files_owner_admin_read
  on public.tenant_package_files for select to authenticated
  using (
    app.can_read_tenant_package(brand_id)
    and exists (
      select 1
      from public.tenant_package_publications publication
      where publication.brand_id = tenant_package_files.brand_id
        and publication.current_release_id = tenant_package_files.package_release_id
    )
  );

do $$
begin
  if not exists (
    select 1
    from public.tenant_package_access_events event
    left join public.tenant_package_files file
      on file.id = event.file_id
      and file.package_release_id = event.package_release_id
      and file.brand_id = event.brand_id
    where event.file_id is not null
      and file.id is null
  ) then
    alter table public.tenant_package_access_events
      validate constraint tenant_package_access_events_file_release_brand_fkey;
  end if;

  if not exists (
    select 1
    from public.tenant_package_access_events access_event
    where (access_event.action in ('preview', 'file_download')
        and access_event.file_id is null)
      or (access_event.action in ('tree', 'archive_download', 'admin_override')
        and access_event.file_id is not null)
  ) then
    alter table public.tenant_package_access_events
      validate constraint tenant_package_access_events_action_file_check;
  end if;
end
$$;

create or replace function public.record_tenant_package_access(
  p_brand_id uuid,
  p_release_id uuid,
  p_file_id uuid,
  p_actor_id uuid,
  p_action text,
  p_outcome text,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent_hash text,
  p_metadata jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare event_id bigint;
begin
  if p_action in ('preview', 'file_download') and p_file_id is null then
    raise exception using
      errcode = '23514',
      message = 'tenant_package_access_file_required';
  end if;

  if p_action in ('tree', 'archive_download', 'admin_override')
     and p_file_id is not null then
    raise exception using
      errcode = '23514',
      message = 'tenant_package_access_file_forbidden';
  end if;

  if p_file_id is not null and not exists (
    select 1
    from public.tenant_package_files file
    where file.id = p_file_id
      and file.package_release_id = p_release_id
      and file.brand_id = p_brand_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'tenant_package_access_file_mismatch';
  end if;

  insert into public.tenant_package_access_events (
    brand_id, package_release_id, file_id, actor_id, action, outcome,
    request_id, ip_hash, user_agent_hash, metadata
  ) values (
    p_brand_id, p_release_id, p_file_id, p_actor_id, p_action, p_outcome,
    p_request_id, p_ip_hash, p_user_agent_hash, p_metadata
  ) returning id into event_id;
  return event_id;
end $$;
revoke all on function public.record_tenant_package_access(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_tenant_package_access(
  uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb
) to service_role;

create or replace function app.assert_tenant_package_access_integrity()
returns void language plpgsql stable set search_path = '' as $$
declare
  file_constraint text;
  file_constraint_valid boolean;
  action_constraint text;
  action_constraint_valid boolean;
  access_index text;
  file_policy text;
  release_policy text;
  recorder_source text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid),
    constraint_row.convalidated
  into file_constraint, file_constraint_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.tenant_package_access_events'::regclass
    and constraint_row.conname =
      'tenant_package_access_events_file_release_brand_fkey';

  select pg_catalog.pg_get_constraintdef(constraint_row.oid),
    constraint_row.convalidated
  into action_constraint, action_constraint_valid
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.tenant_package_access_events'::regclass
    and constraint_row.conname = 'tenant_package_access_events_action_file_check';

  select index_row.indexdef into access_index
  from pg_catalog.pg_indexes index_row
  where index_row.schemaname = 'public'
    and index_row.tablename = 'tenant_package_access_events'
    and index_row.indexname =
      'tenant_package_access_events_file_release_brand_idx';

  select policy_row.qual into file_policy
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'tenant_package_files'
    and policy_row.policyname = 'tenant_package_files_owner_admin_read';

  select policy_row.qual into release_policy
  from pg_catalog.pg_policies policy_row
  where policy_row.schemaname = 'public'
    and policy_row.tablename = 'tenant_package_releases'
    and policy_row.policyname = 'tenant_package_releases_owner_admin_read';

  select procedure_row.prosrc into recorder_source
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid =
    'public.record_tenant_package_access(uuid,uuid,uuid,uuid,text,text,uuid,text,text,jsonb)'::regprocedure;

  if file_constraint is null
     or file_constraint_valid is distinct from true
     or action_constraint is null
     or action_constraint_valid is distinct from true
     or access_index is null
     or file_policy is null
     or release_policy is null
     or recorder_source is null
     or file_constraint !~
       'FOREIGN KEY \(file_id, package_release_id, brand_id\)'
     or file_constraint !~
       'REFERENCES (public\.)?tenant_package_files\(id, package_release_id, brand_id\)'
     or action_constraint !~ 'preview.*file_download.*file_id IS NOT NULL'
     or action_constraint !~
       'tree.*archive_download.*admin_override.*file_id IS NULL'
     or access_index !~
       '\(file_id, package_release_id, brand_id\)'
     or file_policy !~ 'tenant_package_publications'
     or file_policy !~ 'current_release_id'
     or file_policy !~ 'package_release_id'
     or release_policy !~ 'tenant_package_publications'
     or release_policy !~ 'current_release_id'
     or recorder_source !~ 'tenant_package_access_file_mismatch'
     or recorder_source !~ 'tenant_package_access_file_required'
     or recorder_source !~ 'tenant_package_access_file_forbidden' then
    raise exception 'tenant package access integrity contract is incomplete';
  end if;
end $$;
revoke all on function app.assert_tenant_package_access_integrity()
  from public, anon, authenticated;
grant execute on function app.assert_tenant_package_access_integrity()
  to service_role;

select app.register_release(
  '20260908229000',
  'bind tenant package access files to their release and action',
  'app.assert_tenant_package_access_integrity()'::regprocedure
);
