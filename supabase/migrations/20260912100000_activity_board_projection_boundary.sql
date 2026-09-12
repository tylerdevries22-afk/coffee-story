-- Keep the display's narrow, tenant-scoped privilege boundary in a private
-- helper. The REST view itself uses caller privileges and passes advisor checks.
create or replace function app.read_activity_board_items()
returns table (
  id uuid, brand_id uuid, location_id uuid, title text, audience_labels text[],
  status app.operation_occurrence_status, scheduled_for timestamptz,
  due_at timestamptz, actor_name text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select occurrence.id,
         occurrence.brand_id,
         occurrence.location_id,
         left(occurrence.template_snapshot->>'title', 200) as title,
         array(
           select role.name
             from jsonb_array_elements_text(
               coalesce(occurrence.template_snapshot->'requiredRoleIds', '[]'::jsonb)
             ) role_id
             join public.workforce_roles role
               on role.id::text = role_id.value
              and role.brand_id = occurrence.brand_id
            order by role.sort_order, role.name
         ) as audience_labels,
         occurrence.status,
         occurrence.scheduled_for,
         occurrence.due_at,
         nullif(btrim(actor.display_name), '') as actor_name,
         occurrence.updated_at
    from public.operation_occurrences occurrence
    join public.brands brand on brand.id = occurrence.brand_id
    left join public.brand_users actor
      on actor.id = occurrence.claimed_by
     and actor.brand_id = occurrence.brand_id
   where brand.brand_config #>> '{board,mode}' = 'activity'
     and occurrence.status in ('scheduled', 'claimed', 'completed')
     and (occurrence.status <> 'completed'
       or occurrence.completed_at > now() - interval '12 hours')
     and app.can_read_board(occurrence.brand_id, occurrence.location_id);
$$;
revoke all on function app.read_activity_board_items() from public, anon, authenticated;
grant execute on function app.read_activity_board_items() to authenticated, service_role;

create or replace view public.activity_board_items
with (security_barrier = true, security_invoker = true) as
  select * from app.read_activity_board_items();

create or replace function app.assert_activity_board_projection_boundary()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.assert_activity_board_security();
  if not exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.activity_board_items'::regclass
      and coalesce(relation.reloptions, '{}'::text[])
        @> array['security_invoker=true', 'security_barrier=true']
  ) then
    raise exception 'activity board requires an invoker security-barrier view';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid = 'app.read_activity_board_items()'::regprocedure
      and proc.prosecdef and proc.provolatile = 's'
      and coalesce(proc.proconfig, '{}'::text[]) @> array['search_path=""']
  ) then
    raise exception 'activity board requires a stable, search-path-safe definer helper';
  end if;
  if pg_catalog.has_function_privilege('anon', 'app.read_activity_board_items()', 'execute')
    or not pg_catalog.has_function_privilege(
      'authenticated', 'app.read_activity_board_items()', 'execute') then
    raise exception 'activity board helper grants must match authenticated displays';
  end if;
end $$;
revoke all on function app.assert_activity_board_projection_boundary()
  from public, anon, authenticated;
grant execute on function app.assert_activity_board_projection_boundary() to service_role;

create or replace function app.assert_hosted_advisor_compatibility()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'app.release_assertions'::regclass
      and attribute.attname = 'assertion'
      and attribute.atttypid = 'pg_catalog.text'::regtype
      and not attribute.attisdropped
  ) then
    raise exception 'release assertions must use an upgrade-safe text identity';
  end if;
  perform app.assert_activity_board_projection_boundary();
  if exists (
    select 1 from app.release_assertions registered
    where registered.assertion is not null
      and pg_catalog.to_regprocedure(registered.assertion) is null
  ) then
    raise exception 'release registry contains an unresolved assertion';
  end if;
end $$;

create or replace function app.assert_activity_board_definer_and_refund_proof()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  rpc constant text := 'public.process_square_refund(uuid,text,text,bigint,text)';
  rpc_proc pg_catalog.pg_proc%rowtype;
begin
  perform app.assert_activity_board_projection_boundary();
  select proc.* into rpc_proc from pg_catalog.pg_proc proc
  where proc.oid = pg_catalog.to_regprocedure(rpc);
  if rpc_proc.oid is null or not rpc_proc.prosecdef then
    raise exception 'process_square_refund must remain security definer';
  end if;
end $$;

select app.register_release(
  '20260912100000',
  'advisor-compatible activity board with a private scoped projection helper',
  'app.assert_activity_board_projection_boundary()'::regprocedure
);
