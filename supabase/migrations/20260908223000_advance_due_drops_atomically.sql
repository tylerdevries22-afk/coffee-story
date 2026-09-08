-- Advance drop lifecycle rows in finite, concurrency-safe batches.
--
-- The previous worker selected every active row and issued one PATCH per
-- transition. A concurrent owner edit could be overwritten between those
-- calls, and PostgREST's row cap could indefinitely hide later due rows.
create index if not exists drops_pending_ends_idx
  on public.drops (ends_at, id)
  where status in ('scheduled', 'revealed', 'live');
create index if not exists drops_pending_starts_idx
  on public.drops (starts_at, id)
  where status in ('scheduled', 'revealed');
create index if not exists drops_pending_reveals_idx
  on public.drops (reveal_at, id)
  where status = 'scheduled' and reveal_at is not null;

create or replace function public.advance_due_drop_batch(
  target_now timestamptz,
  target_limit integer default 200
)
returns table (id uuid, from_status text, to_status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_now is null or target_limit is null
    or target_limit < 1 or target_limit > 200
  then
    raise exception 'invalid drop transition batch inputs';
  end if;

  return query
  with candidates as materialized (
    select
      d.id,
      d.status as from_status,
      case
        when d.ends_at <= target_now then 'ended'
        when d.status in ('scheduled', 'revealed') and d.starts_at <= target_now then 'live'
        else 'revealed'
      end as to_status,
      case
        when d.ends_at <= target_now then d.ends_at
        when d.status in ('scheduled', 'revealed') and d.starts_at <= target_now then d.starts_at
        else d.reveal_at
      end as due_at
    from public.drops d
    where (d.status in ('scheduled', 'revealed', 'live') and d.ends_at <= target_now)
      or (d.status in ('scheduled', 'revealed') and d.starts_at <= target_now)
      or (d.status = 'scheduled' and d.reveal_at is not null and d.reveal_at <= target_now)
    order by due_at, d.id
    for update of d skip locked
    limit target_limit
  ), advanced as (
    update public.drops d
    set status = candidate.to_status
    from candidates candidate
    where d.id = candidate.id
      and d.status = candidate.from_status
    returning d.id, candidate.from_status, candidate.to_status
  )
  select advanced.id, advanced.from_status, advanced.to_status
  from advanced;
end
$$;

revoke all on function public.advance_due_drop_batch(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.advance_due_drop_batch(timestamptz, integer)
  to service_role;

create or replace function app.assert_due_drop_batch()
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if pg_catalog.to_regprocedure(
    'public.advance_due_drop_batch(timestamp with time zone,integer)'
  ) is null then
    raise exception 'advance_due_drop_batch is missing';
  end if;
  if pg_catalog.has_function_privilege(
    'anon', 'public.advance_due_drop_batch(timestamp with time zone,integer)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'public.advance_due_drop_batch(timestamp with time zone,integer)', 'EXECUTE'
  ) then
    raise exception 'drop transition batch is exposed to client roles';
  end if;
end
$$;

revoke all on function app.assert_due_drop_batch() from public, anon, authenticated;
grant execute on function app.assert_due_drop_batch() to service_role;

select app.register_release(
  '20260908223000',
  'advance due drops atomically in bounded batches',
  'app.assert_due_drop_batch()'::regprocedure
);
