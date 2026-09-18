-- Demo runs: the queue, the brakes and the ledger behind the demo factory.
--
-- An operator asks for a batch ("coffee shops in Boulder, CO", up to one
-- search page of 20). The free IDs-only search turns it into one job per
-- business, and a scheduled tick claims a few jobs at a time and builds each
-- one into a platform_demo_sites row.
--
-- Every billed call a job makes is appended to a ledger as it happens, in
-- integer micro-dollars: a Place Details call is $0.020 and a gpt-5-nano input
-- token is $0.00000005, and neither fits whole cents. So what one business
-- cost is a sum over rows that can be reconciled against the invoice, not an
-- estimate. The ledger cannot be rewritten, only appended to.
--
-- The factory is off until someone turns it on. It stops by itself at a daily
-- count and a daily spend, and both limits are checked in the same call that
-- hands out work, under a lock, so two ticks cannot both take the last slot.

create table public.platform_demo_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  daily_limit integer not null default 100 check (daily_limit between 0 and 500),
  daily_budget_microusd bigint not null default 10000000
    check (daily_budget_microusd between 0 and 1000000000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.platform_demo_settings is
  'The demo factory''s kill switch and daily brakes. One row; off by default.';

insert into public.platform_demo_settings (singleton) values (true);

create index platform_demo_settings_updated_by_idx
  on public.platform_demo_settings (updated_by);

create table public.platform_demo_batches (
  id uuid primary key default gen_random_uuid(),
  query text not null check (length(btrim(query)) between 3 and 200),
  requested integer not null check (requested between 1 and 20),
  found integer not null default 0 check (found between 0 and requested),
  state text not null default 'running' check (state in ('running', 'done', 'stopped')),
  unit_estimate_microusd bigint not null default 0
    check (unit_estimate_microusd between 0 and 10000000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint platform_demo_batches_finished_when_settled
    check ((state = 'running') = (finished_at is null))
);

comment on table public.platform_demo_batches is
  'One operator request for demos: a search and how many businesses it may build.';

create index platform_demo_batches_created_by_idx
  on public.platform_demo_batches (created_by);
create index platform_demo_batches_recent_idx
  on public.platform_demo_batches (created_at desc);

create table public.platform_demo_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.platform_demo_batches (id),
  google_place_id text not null check (google_place_id ~ '^[A-Za-z0-9_-]{6,255}$'),
  state text not null default 'queued'
    check (state in ('queued', 'working', 'built', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_expires_at timestamptz,
  claimed_at timestamptz,
  outcome text check (outcome is null or outcome ~ '^[a-z]+(_[a-z]+)*$'),
  site_id uuid references public.platform_demo_sites (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint platform_demo_jobs_once_per_batch unique (batch_id, google_place_id),
  constraint platform_demo_jobs_lease_while_working
    check ((state = 'working') = (lease_expires_at is not null)),
  constraint platform_demo_jobs_finished_when_settled
    check ((state in ('queued', 'working')) = (finished_at is null)),
  constraint platform_demo_jobs_built_has_site check ((state = 'built') = (site_id is not null)),
  constraint platform_demo_jobs_settled_has_outcome
    check (state not in ('skipped', 'failed') or outcome is not null)
);

comment on table public.platform_demo_jobs is
  'One business in a batch, from queued to built, skipped or failed; outcome says why.';

-- One business is never being built twice at once, whichever batches it is in,
-- so two operators searching the same street cannot pay for it twice.
create unique index platform_demo_jobs_one_pending_per_place
  on public.platform_demo_jobs (google_place_id)
  where state in ('queued', 'working');

create index platform_demo_jobs_due_idx
  on public.platform_demo_jobs (created_at)
  where state in ('queued', 'working');
create index platform_demo_jobs_claimed_idx on public.platform_demo_jobs (claimed_at);
create index platform_demo_jobs_site_id_idx on public.platform_demo_jobs (site_id);

create table public.platform_demo_costs (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.platform_demo_batches (id),
  job_id uuid references public.platform_demo_jobs (id),
  provider text not null check (provider in ('google_places', 'openai')),
  sku text not null check (sku ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and length(sku) <= 64),
  model text check (model is null or model ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  quantity bigint not null check (quantity >= 0),
  cost_microusd bigint not null check (cost_microusd between 0 and 100000000),
  recorded_at timestamptz not null default now()
);

comment on table public.platform_demo_costs is
  'Append-only: every billed call the demo factory made, priced in micro-dollars when made.';

create index platform_demo_costs_batch_id_idx on public.platform_demo_costs (batch_id);
create index platform_demo_costs_job_id_idx on public.platform_demo_costs (job_id);
create index platform_demo_costs_recorded_at_idx on public.platform_demo_costs (recorded_at);

create trigger platform_demo_settings_touch before update on public.platform_demo_settings
for each row execute function app.touch_updated_at();
create trigger platform_demo_batches_touch before update on public.platform_demo_batches
for each row execute function app.touch_updated_at();
create trigger platform_demo_jobs_touch before update on public.platform_demo_jobs
for each row execute function app.touch_updated_at();
create trigger platform_demo_costs_append_only
before update or delete on public.platform_demo_costs
for each row execute function app.reject_record_mutation();

alter table public.platform_demo_settings enable row level security;
alter table public.platform_demo_batches enable row level security;
alter table public.platform_demo_jobs enable row level security;
alter table public.platform_demo_costs enable row level security;

create policy platform_demo_settings_platform_read on public.platform_demo_settings
for select to authenticated using (app.is_platform_admin());
create policy platform_demo_batches_platform_read on public.platform_demo_batches
for select to authenticated using (app.is_platform_admin());
create policy platform_demo_jobs_platform_read on public.platform_demo_jobs
for select to authenticated using (app.is_platform_admin());
create policy platform_demo_costs_platform_read on public.platform_demo_costs
for select to authenticated using (app.is_platform_admin());

revoke all on public.platform_demo_settings, public.platform_demo_batches,
  public.platform_demo_jobs, public.platform_demo_costs
  from public, anon, authenticated;
grant select on public.platform_demo_settings, public.platform_demo_batches,
  public.platform_demo_jobs, public.platform_demo_costs to authenticated;
grant all on public.platform_demo_settings, public.platform_demo_batches,
  public.platform_demo_jobs, public.platform_demo_costs to service_role;
revoke all on sequence public.platform_demo_costs_id_seq from public, anon, authenticated;
grant usage, select on sequence public.platform_demo_costs_id_seq to service_role;

-- A batch is born with its jobs. Businesses that asked to be left alone, that
-- already have a live demo or that another batch is already building are
-- recorded as skipped here, before anything is billed for them; a batch with
-- nothing left to build is born finished.
create function public.create_platform_demo_batch(
  p_query text,
  p_requested integer,
  p_place_ids text[],
  p_unit_estimate_microusd bigint,
  p_created_by uuid default null
)
returns table (id uuid, found integer, queued integer)
language sql security invoker set search_path = '' as $$
  with candidates as (
    select distinct place.value as google_place_id
      from unnest(coalesce(p_place_ids, '{}'::text[])) as place (value)
     where place.value is not null
  ),
  classified as (
    select candidate.google_place_id,
           case
             when exists (
               select 1 from public.platform_demo_suppressions as suppression
                where suppression.kind = 'google_place' and suppression.value = candidate.google_place_id
             ) then 'suppressed'
             when exists (
               select 1 from public.platform_demo_sites as site
                where site.google_place_id = candidate.google_place_id and site.state in ('building', 'ready')
             ) then 'already_live'
             when exists (
               select 1 from public.platform_demo_jobs as pending
                where pending.google_place_id = candidate.google_place_id
                  and pending.state in ('queued', 'working')
             ) then 'already_queued'
           end as reason
      from candidates as candidate
  ),
  batch as (
    insert into public.platform_demo_batches (
      query, requested, found, state, finished_at, unit_estimate_microusd, created_by
    )
    select btrim(p_query), p_requested, (select count(*)::integer from classified),
           case when exists (select 1 from classified where classified.reason is null)
                then 'running' else 'done' end,
           case when exists (select 1 from classified where classified.reason is null)
                then null else now() end,
           p_unit_estimate_microusd, p_created_by
    returning platform_demo_batches.id, platform_demo_batches.found
  ),
  jobs as (
    insert into public.platform_demo_jobs (batch_id, google_place_id, state, outcome, finished_at)
    select batch.id, classified.google_place_id,
           case when classified.reason is null then 'queued' else 'skipped' end,
           classified.reason,
           case when classified.reason is null then null else now() end
      from batch cross join classified
    returning platform_demo_jobs.state
  )
  select batch.id, batch.found,
         (select count(*)::integer from jobs where jobs.state = 'queued')
    from batch;
$$;

-- Hands out at most p_limit jobs, or none when the factory is off, today's
-- count is used up or today's spend has reached the budget. The settings row
-- is locked first, so concurrent ticks take turns and read each other's
-- claims. A lease that expired is someone's crashed attempt: it is claimed
-- again until the third try, and after that the job fails as abandoned.
create function public.claim_platform_demo_jobs(
  p_limit integer default 2,
  p_lease_seconds integer default 300
)
returns table (id uuid, batch_id uuid, google_place_id text, attempt integer, created_by uuid)
language sql security invoker set search_path = '' as $$
  select 1 from public.platform_demo_settings as settings where settings.singleton for update;

  update public.platform_demo_jobs as job
     set state = case when batch.state = 'running' then 'failed' else 'skipped' end,
         outcome = case when batch.state = 'running' then 'abandoned' else 'stopped' end,
         lease_expires_at = null,
         finished_at = now()
    from public.platform_demo_batches as batch
   where batch.id = job.batch_id
     and job.state = 'working'
     and job.lease_expires_at <= now()
     and (job.attempts >= 3 or batch.state <> 'running');

  update public.platform_demo_batches as batch
     set state = 'done', finished_at = now()
   where batch.state = 'running'
     and not exists (
       select 1 from public.platform_demo_jobs as pending
        where pending.batch_id = batch.id and pending.state in ('queued', 'working')
     );

  with today as (
    select date_trunc('day', now() at time zone 'utc') at time zone 'utc' as starts
  ),
  room as (
    select greatest(0, least(
             greatest(coalesce(p_limit, 2), 1), 10,
             settings.daily_limit - (
               select count(*)::integer from public.platform_demo_jobs as claimed, today
                where claimed.claimed_at >= today.starts
             )
           )) as slots
      from public.platform_demo_settings as settings
     where settings.singleton
       and settings.enabled
       and settings.daily_budget_microusd > (
         select coalesce(sum(cost.cost_microusd), 0)
           from public.platform_demo_costs as cost, today
          where cost.recorded_at >= today.starts
       )
  ),
  picked as (
    select due.id
      from public.platform_demo_jobs as due
      join public.platform_demo_batches as batch on batch.id = due.batch_id
     where batch.state = 'running'
       and due.attempts < 3
       and (due.state = 'queued' or (due.state = 'working' and due.lease_expires_at <= now()))
     order by due.created_at, due.id
     limit (select coalesce(max(room.slots), 0) from room)
     for update of due skip locked
  )
  update public.platform_demo_jobs as job
     set state = 'working',
         attempts = job.attempts + 1,
         lease_expires_at = now() + make_interval(
           secs => least(greatest(coalesce(p_lease_seconds, 300), 60), 900)
         ),
         claimed_at = coalesce(job.claimed_at, now())
    from picked, public.platform_demo_batches as batch
   where job.id = picked.id and batch.id = job.batch_id
  returning job.id, job.batch_id, job.google_place_id, job.attempts, batch.created_by;
$$;

-- Only the attempt that holds the lease may settle a job, so a worker that
-- stalled past its lease cannot overwrite the result of the one that took
-- over. 'queued' hands a job back for another try after a transient failure,
-- until the third attempt, which fails it instead.
create function public.finish_platform_demo_job(
  p_job_id uuid,
  p_attempt integer,
  p_state text,
  p_outcome text default null,
  p_site_id uuid default null
)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  settled_batch uuid;
begin
  if p_state is null or p_state not in ('queued', 'built', 'skipped', 'failed') then
    raise exception using errcode = '22023', message = 'demo_job_state_invalid';
  end if;

  update public.platform_demo_jobs as job
     set state = case when p_state = 'queued' and job.attempts >= 3 then 'failed' else p_state end,
         outcome = p_outcome,
         site_id = p_site_id,
         lease_expires_at = null,
         finished_at = case when p_state = 'queued' and job.attempts < 3 then null else now() end
   where job.id = p_job_id and job.state = 'working' and job.attempts = p_attempt
  returning job.batch_id into settled_batch;

  if settled_batch is null then
    return false;
  end if;

  update public.platform_demo_batches as batch
     set state = 'done', finished_at = now()
   where batch.id = settled_batch
     and batch.state = 'running'
     and not exists (
       select 1 from public.platform_demo_jobs as pending
        where pending.batch_id = batch.id and pending.state in ('queued', 'working')
     );
  return true;
end $$;

-- Stopping a batch skips what has not started; a job already being built
-- finishes, because its money is already spent.
create function public.stop_platform_demo_batch(p_batch_id uuid)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  skipped bigint;
begin
  update public.platform_demo_batches as batch
     set state = 'stopped', finished_at = now()
   where batch.id = p_batch_id and batch.state = 'running';
  if not found then
    return 0;
  end if;

  update public.platform_demo_jobs as job
     set state = 'skipped', outcome = 'stopped', finished_at = now()
   where job.batch_id = p_batch_id and job.state = 'queued';
  get diagnostics skipped = row_count;
  return skipped::integer;
end $$;

-- What the factory spent, per UTC day and line item, so a runaway shows up
-- within the day rather than on the invoice.
create function public.platform_demo_daily_costs(p_days integer default 14)
returns table (
  day date, provider text, sku text, model text, quantity bigint, cost_microusd bigint
)
language sql stable security invoker set search_path = '' as $$
  select (cost.recorded_at at time zone 'utc')::date,
         cost.provider, cost.sku, cost.model,
         sum(cost.quantity)::bigint, sum(cost.cost_microusd)::bigint
    from public.platform_demo_costs as cost
   where cost.recorded_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
         - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 92) - 1)
   group by 1, 2, 3, 4
   order by 1 desc, 6 desc;
$$;

-- What each business in a batch actually cost, next to what became of it.
create function public.platform_demo_job_costs(p_batch_id uuid)
returns table (
  job_id uuid, google_place_id text, state text, outcome text, site_id uuid,
  attempts integer, cost_microusd bigint
)
language sql stable security invoker set search_path = '' as $$
  select job.id, job.google_place_id, job.state, job.outcome, job.site_id, job.attempts,
         coalesce((
           select sum(cost.cost_microusd) from public.platform_demo_costs as cost
            where cost.job_id = job.id
         ), 0)::bigint
    from public.platform_demo_jobs as job
   where job.batch_id = p_batch_id
   order by job.created_at, job.id;
$$;

revoke all on function public.create_platform_demo_batch(text, integer, text[], bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_platform_demo_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.finish_platform_demo_job(uuid, integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.stop_platform_demo_batch(uuid) from public, anon, authenticated;
revoke all on function public.platform_demo_daily_costs(integer) from public, anon, authenticated;
revoke all on function public.platform_demo_job_costs(uuid) from public, anon, authenticated;
grant execute on function public.create_platform_demo_batch(text, integer, text[], bigint, uuid) to service_role;
grant execute on function public.claim_platform_demo_jobs(integer, integer) to service_role;
grant execute on function public.finish_platform_demo_job(uuid, integer, text, text, uuid) to service_role;
grant execute on function public.stop_platform_demo_batch(uuid) to service_role;
grant execute on function public.platform_demo_daily_costs(integer) to service_role;
grant execute on function public.platform_demo_job_costs(uuid) to service_role;

create function app.assert_platform_demo_runs()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid in (
      'public.platform_demo_settings'::regclass, 'public.platform_demo_batches'::regclass,
      'public.platform_demo_jobs'::regclass, 'public.platform_demo_costs'::regclass
    ) and not relation.relrowsecurity
  ) then
    raise exception 'demo runs lost row level security';
  end if;
  if not exists (select 1 from public.platform_demo_settings settings where settings.singleton) then
    raise exception 'the demo factory has no kill switch';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.platform_demo_costs'::regclass
      and trigger_row.tgname = 'platform_demo_costs_append_only'
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'the demo cost ledger can be rewritten';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'public' and index_row.tablename = 'platform_demo_jobs'
      and index_row.indexname = 'platform_demo_jobs_one_pending_per_place'
  ) then
    raise exception 'one business could be built, and billed, twice at once';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.claim_platform_demo_jobs(integer, integer)', 'execute')
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.create_platform_demo_batch(text, integer, text[], bigint, uuid)', 'execute')
    or pg_catalog.has_table_privilege('anon', 'public.platform_demo_costs', 'select')
    or pg_catalog.has_table_privilege('authenticated', 'public.platform_demo_settings', 'update')
  then
    raise exception 'demo runs are reachable by a client role';
  end if;
end $$;

revoke all on function app.assert_platform_demo_runs() from public, anon, authenticated;
grant execute on function app.assert_platform_demo_runs() to service_role;

select app.register_release(
  '20260918130000',
  'demo runs: batches, leased jobs, an append-only cost ledger and a kill switch that starts off',
  'app.assert_platform_demo_runs()'::regprocedure
);
