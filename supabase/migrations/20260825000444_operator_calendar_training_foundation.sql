-- Calendar, workforce, and autonomous-training release foundations.
--
-- Calendar domain records are tenant-owned. Existing shifts, orders, and
-- training assignments stay authoritative and are projected into the calendar
-- by application adapters; calendar_entries stores only standalone events.

-- Close the only mutable-search-path warning inherited from the preceding
-- pack migration so a fresh franchise database passes the security advisor.
alter function app.pack_choices(public.menu_items, timestamptz)
  set search_path = '';

create or replace function app.is_brand_manager(target_brand uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    app.is_brand_owner(target_brand)
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() = 'location_manager'),
    false)
$$;

create or replace function app.manages_location(
  target_brand uuid,
  target_location uuid
) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    app.is_brand_owner(target_brand)
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() = 'location_manager'
        and target_location = any (app.jwt_location_ids())),
    false)
$$;

create or replace function app.calendar_row_visible(
  target_brand uuid,
  target_location uuid
) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    case
      when target_location is null then app.is_brand_staff(target_brand)
      else app.at_location(target_brand, target_location)
    end,
    false)
$$;

create or replace function app.is_current_brand_user(
  target_brand uuid,
  target_brand_user uuid
) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(exists (
    select 1
    from public.brand_users member
    where member.id = target_brand_user
      and member.brand_id = target_brand
      and member.user_id = (select auth.uid())
  ), false)
$$;

-- Composite keys let every child relationship enforce tenant identity rather
-- than trusting application code to keep brand_id pairs aligned.
alter table public.locations
  add constraint locations_id_brand_key unique (id, brand_id);
alter table public.brand_users
  add constraint brand_users_id_brand_key unique (id, brand_id);

-- Location managers need the people assigned to their locations for person
-- filters and schedule assignment. Keep this as one policy so Postgres does
-- not evaluate multiple permissive policies for every membership row.
drop policy brand_users_select on public.brand_users;
create policy brand_users_select on public.brand_users for select to authenticated
  using (
    app.is_brand_owner(brand_id)
    or user_id = (select auth.uid())
    or (app.jwt_brand_id() = brand_id
      and app.jwt_role() = 'location_manager'
      and location_ids && app.jwt_location_ids())
  );

create table public.workforce_roles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, slug),
  unique (id, brand_id)
);

create table public.workforce_profiles (
  brand_user_id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  worker_type text not null default 'employee'
    check (worker_type in ('employee', 'contractor')),
  job_title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade
);

create table public.workforce_role_assignments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  brand_user_id uuid not null,
  workforce_role_id uuid not null,
  location_id uuid,
  created_at timestamptz not null default now(),
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade,
  foreign key (workforce_role_id, brand_id)
    references public.workforce_roles (id, brand_id) on delete cascade,
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  unique nulls not distinct
    (brand_id, brand_user_id, workforce_role_id, location_id)
);

create index workforce_roles_brand_order_idx
  on public.workforce_roles (brand_id, is_active, sort_order);
create index workforce_role_assignments_user_idx
  on public.workforce_role_assignments (brand_user_id, location_id);
create index workforce_role_assignments_role_idx
  on public.workforce_role_assignments (workforce_role_id, location_id);

create table public.calendar_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  core_kind text not null check (core_kind in (
    'training', 'project', 'scheduled_shift', 'task', 'order',
    'event', 'blockout', 'custom'
  )),
  icon_key text not null check (icon_key in (
    'graduation-cap', 'briefcase-business', 'clock-3', 'square-check-big',
    'shopping-bag', 'calendar-days', 'calendar-off', 'shapes', 'coffee',
    'wrench', 'heart-pulse', 'users', 'map-pin', 'star'
  )),
  accent_color text not null check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  detail_template text not null default 'generic'
    check (detail_template in (
      'training', 'project', 'shift', 'task', 'order',
      'event', 'blockout', 'generic'
    )),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, slug),
  unique (id, brand_id)
);

create index calendar_categories_brand_order_idx
  on public.calendar_categories (brand_id, is_active, sort_order);

create or replace function app.seed_calendar_categories() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.calendar_categories (
    brand_id, slug, name, core_kind, icon_key, accent_color, detail_template, sort_order
  ) values
    (new.id, 'training', 'Training', 'training', 'graduation-cap', '#7C3AED', 'training', 10),
    (new.id, 'projects', 'Projects', 'project', 'briefcase-business', '#2563EB', 'project', 20),
    (new.id, 'shifts', 'Scheduled shifts', 'scheduled_shift', 'clock-3', '#059669', 'shift', 30),
    (new.id, 'tasks', 'Tasks', 'task', 'square-check-big', '#D97706', 'task', 40),
    (new.id, 'orders', 'Orders', 'order', 'shopping-bag', '#DB2777', 'order', 50),
    (new.id, 'events', 'Events', 'event', 'calendar-days', '#0891B2', 'event', 60),
    (new.id, 'blockouts', 'Blockouts', 'blockout', 'calendar-off', '#DC2626', 'blockout', 70)
  on conflict (brand_id, slug) do nothing;
  return new;
end $$;

create trigger brands_seed_calendar_categories
  after insert on public.brands
  for each row execute function app.seed_calendar_categories();

insert into public.calendar_categories (
  brand_id, slug, name, core_kind, icon_key, accent_color, detail_template, sort_order
)
select brand.id, category.slug, category.name, category.core_kind,
  category.icon_key, category.accent_color, category.detail_template, category.sort_order
from public.brands brand
cross join (values
  ('training', 'Training', 'training', 'graduation-cap', '#7C3AED', 'training', 10),
  ('projects', 'Projects', 'project', 'briefcase-business', '#2563EB', 'project', 20),
  ('shifts', 'Scheduled shifts', 'scheduled_shift', 'clock-3', '#059669', 'shift', 30),
  ('tasks', 'Tasks', 'task', 'square-check-big', '#D97706', 'task', 40),
  ('orders', 'Orders', 'order', 'shopping-bag', '#DB2777', 'order', 50),
  ('events', 'Events', 'event', 'calendar-days', '#0891B2', 'event', 60),
  ('blockouts', 'Blockouts', 'blockout', 'calendar-off', '#DC2626', 'blockout', 70)
) as category(slug, name, core_kind, icon_key, accent_color, detail_template, sort_order)
on conflict (brand_id, slug) do nothing;

create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
  category_id uuid not null,
  project_key text,
  title text not null check (length(btrim(title)) between 1 and 200),
  summary text not null default '',
  status text not null default 'scheduled'
    check (status ~ '^[a-z][a-z0-9_]{0,62}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'UTC',
  is_all_day boolean not null default false,
  recurrence_rule text,
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  foreign key (category_id, brand_id)
    references public.calendar_categories (id, brand_id) on delete restrict,
  foreign key (created_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (created_by),
  unique (id, brand_id)
);

create index calendar_entries_range_idx
  on public.calendar_entries (brand_id, starts_at, ends_at);
create index calendar_entries_location_range_idx
  on public.calendar_entries (location_id, starts_at, ends_at)
  where location_id is not null;
create index calendar_entries_project_range_idx
  on public.calendar_entries (brand_id, project_key, starts_at)
  where project_key is not null;

create table public.calendar_entry_assignments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  calendar_entry_id uuid not null,
  brand_user_id uuid not null,
  workforce_role_id uuid,
  assignment_status text not null default 'assigned'
    check (assignment_status in ('assigned', 'accepted', 'declined', 'completed')),
  created_at timestamptz not null default now(),
  foreign key (calendar_entry_id, brand_id)
    references public.calendar_entries (id, brand_id) on delete cascade,
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade,
  foreign key (workforce_role_id, brand_id)
    references public.workforce_roles (id, brand_id)
    on delete set null (workforce_role_id),
  unique (calendar_entry_id, brand_user_id)
);

create index calendar_entry_assignments_user_idx
  on public.calendar_entry_assignments (brand_user_id, calendar_entry_id);

create table public.availability_blockouts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
  brand_user_id uuid,
  project_key text,
  scope_kind text not null
    check (scope_kind in ('brand', 'location', 'person', 'project')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'UTC',
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'declined', 'withdrawn')),
  requested_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (
    (status in ('approved', 'declined'))
      = (reviewed_at is not null and reviewed_by is not null)
  ),
  check (
    (scope_kind = 'brand' and location_id is null and brand_user_id is null and project_key is null)
    or (scope_kind = 'location' and location_id is not null and brand_user_id is null and project_key is null)
    or (scope_kind = 'person' and brand_user_id is not null and project_key is null)
    or (scope_kind = 'project' and brand_user_id is null and length(btrim(project_key)) > 0)
  ),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade,
  foreign key (requested_by, brand_id)
    references public.brand_users (id, brand_id) on delete restrict,
  foreign key (reviewed_by, brand_id)
    references public.brand_users (id, brand_id) on delete restrict
);

create index availability_blockouts_range_idx
  on public.availability_blockouts (brand_id, status, starts_at, ends_at);
create index availability_blockouts_location_range_idx
  on public.availability_blockouts (location_id, status, starts_at, ends_at)
  where location_id is not null;
create index availability_blockouts_person_range_idx
  on public.availability_blockouts (brand_user_id, status, starts_at, ends_at)
  where brand_user_id is not null;

-- Service-written workflow metadata. The idempotency key prevents retries or
-- multiple desktop agents from creating parallel releases for one profile.
create table public.training_bootstrap_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  profile_fingerprint text not null check (length(profile_fingerprint) between 32 and 128),
  pipeline_version text not null check (length(btrim(pipeline_version)) between 1 and 50),
  trigger_kind text not null default 'empty_tenant'
    check (trigger_kind in ('empty_tenant', 'profile_changed', 'scheduled_refresh', 'manual')),
  status text not null default 'queued'
    check (status in ('queued', 'researching', 'generating', 'validating', 'published', 'failed', 'cancelled')),
  stage text not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  retry_count smallint not null default 0 check (retry_count between 0 and 8),
  next_attempt_at timestamptz,
  error_code text,
  error_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(error_detail) = 'object'),
  requested_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (requested_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (requested_by),
  unique (brand_id, profile_fingerprint, pipeline_version),
  unique (id, brand_id)
);

create index training_bootstrap_runs_brand_status_idx
  on public.training_bootstrap_runs (brand_id, status, created_at desc);

create table public.training_releases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  bootstrap_run_id uuid,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'validated', 'published', 'retired', 'failed')),
  manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manifest) = 'object'),
  answer_key jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answer_key) = 'object'),
  validated_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('published', 'retired') or published_at is not null),
  foreign key (bootstrap_run_id, brand_id)
    references public.training_bootstrap_runs (id, brand_id) on delete restrict,
  unique (brand_id, version),
  unique (brand_id, bootstrap_run_id),
  unique (id, brand_id)
);

create unique index training_releases_one_published_idx
  on public.training_releases (brand_id) where status = 'published';
create index training_releases_brand_created_idx
  on public.training_releases (brand_id, created_at desc);

create table public.training_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  release_id uuid not null,
  brand_user_id uuid not null,
  module_slug text not null check (module_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  lesson_slug text not null check (lesson_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),
  score smallint check (score between 0 and 100),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (release_id, brand_id)
    references public.training_releases (id, brand_id) on delete cascade,
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade,
  unique (brand_id, release_id, brand_user_id, module_slug, lesson_slug),
  check ((status = 'completed') = (completed_at is not null))
);

create index training_lesson_progress_user_idx
  on public.training_lesson_progress (brand_user_id, release_id, status);

create table public.training_quiz_attempts (
  id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  release_id uuid not null,
  brand_user_id uuid not null,
  module_slug text not null check (module_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  lesson_slug text not null check (lesson_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  score smallint not null check (score between 0 and 100),
  passed boolean not null,
  created_at timestamptz not null default now(),
  foreign key (release_id, brand_id)
    references public.training_releases (id, brand_id) on delete cascade,
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade
);

create index training_quiz_attempts_user_idx
  on public.training_quiz_attempts (brand_user_id, release_id, created_at desc);

create or replace function app.enforce_training_attempt_limit() returns trigger
language plpgsql set search_path = '' as $$
declare
  prior_count integer;
  prior_created_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    new.brand_user_id::text || ':' || new.release_id::text || ':'
      || new.module_slug || ':' || new.lesson_slug,
    0
  ));
  if exists (select 1 from public.training_quiz_attempts where id = new.id) then
    return new;
  end if;
  select count(*), max(created_at) into prior_count, prior_created_at
  from public.training_quiz_attempts
  where brand_id = new.brand_id
    and release_id = new.release_id
    and brand_user_id = new.brand_user_id
    and module_slug = new.module_slug
    and lesson_slug = new.lesson_slug;
  if prior_count >= 5 then
    raise exception using errcode = 'P0001', message = 'training_attempt_limit_reached';
  end if;
  if prior_created_at is not null and prior_created_at > now() - interval '10 seconds' then
    raise exception using errcode = 'P0001', message = 'training_attempt_rate_limited';
  end if;
  return new;
end $$;

create trigger training_quiz_attempts_limit
  before insert on public.training_quiz_attempts
  for each row execute function app.enforce_training_attempt_limit();

-- Publishing is one transaction: a failed insert cannot retire the currently
-- healthy release. The advisory lock also serializes two automation workers
-- finishing for the same tenant at once.
create or replace function public.publish_training_release(
  target_brand uuid,
  target_run uuid,
  release_manifest jsonb,
  release_answer_key jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  next_version integer;
  release_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_brand::text, 0));
  if not exists (
    select 1 from public.training_bootstrap_runs
    where id = target_run and brand_id = target_brand
  ) then
    raise exception 'training bootstrap run does not belong to tenant';
  end if;
  select id into release_id from public.training_releases
  where brand_id = target_brand and bootstrap_run_id = target_run;
  if release_id is not null then
    return release_id;
  end if;
  select coalesce(max(version), 0) + 1 into next_version
  from public.training_releases where brand_id = target_brand;
  update public.training_releases
    set status = 'retired', updated_at = now()
    where brand_id = target_brand and status = 'published';
  insert into public.training_releases (
    brand_id, bootstrap_run_id, version, status, manifest, answer_key,
    validated_at, published_at
  ) values (
    target_brand, target_run, next_version, 'published', release_manifest, release_answer_key,
    now(), now()
  ) returning id into release_id;
  return release_id;
end $$;

revoke all on function public.publish_training_release(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_training_release(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.store_training_profile(
  target_brand uuid,
  tenant_profile jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if jsonb_typeof(tenant_profile) <> 'object' then
    raise exception 'tenant training profile must be an object';
  end if;
  update public.brands
  set brand_config = coalesce(brand_config, '{}'::jsonb)
    || jsonb_build_object(
      'training',
      coalesce(brand_config->'training', '{}'::jsonb)
        || jsonb_build_object('profile', tenant_profile)
    )
  where id = target_brand;
  if not found then raise exception 'tenant brand does not exist'; end if;
end $$;

revoke all on function public.store_training_profile(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.store_training_profile(uuid, jsonb) to service_role;

create or replace function app.protect_calendar_entry_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null
     and (new.brand_id is distinct from old.brand_id
       or new.created_by is distinct from old.created_by) then
    raise exception 'calendar entry tenant and creator are immutable';
  end if;
  return new;
end $$;

create or replace function app.protect_blockout_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null
     and (new.brand_id is distinct from old.brand_id
       or new.scope_kind is distinct from old.scope_kind
       or new.location_id is distinct from old.location_id
       or new.brand_user_id is distinct from old.brand_user_id
       or new.project_key is distinct from old.project_key
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.timezone is distinct from old.timezone
       or new.reason is distinct from old.reason
       or new.requested_by is distinct from old.requested_by
       or new.created_at is distinct from old.created_at) then
    raise exception 'availability request identity is immutable';
  end if;
  return new;
end $$;

create or replace function app.protect_calendar_assignment_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null
     and (new.brand_id is distinct from old.brand_id
       or new.calendar_entry_id is distinct from old.calendar_entry_id
       or new.brand_user_id is distinct from old.brand_user_id
       or new.created_at is distinct from old.created_at) then
    raise exception 'calendar assignment identity is immutable';
  end if;
  return new;
end $$;

-- updated_at ---------------------------------------------------------------

create trigger workforce_roles_touch before update on public.workforce_roles
  for each row execute function app.touch_updated_at();
create trigger workforce_profiles_touch before update on public.workforce_profiles
  for each row execute function app.touch_updated_at();
create trigger calendar_categories_touch before update on public.calendar_categories
  for each row execute function app.touch_updated_at();
create trigger calendar_entries_touch before update on public.calendar_entries
  for each row execute function app.touch_updated_at();
create trigger calendar_entries_protect_identity before update on public.calendar_entries
  for each row execute function app.protect_calendar_entry_identity();
create trigger calendar_entry_assignments_protect_identity
  before update on public.calendar_entry_assignments
  for each row execute function app.protect_calendar_assignment_identity();
create trigger availability_blockouts_touch before update on public.availability_blockouts
  for each row execute function app.touch_updated_at();
create trigger availability_blockouts_protect_identity
  before update on public.availability_blockouts
  for each row execute function app.protect_blockout_identity();
create trigger training_bootstrap_runs_touch before update on public.training_bootstrap_runs
  for each row execute function app.touch_updated_at();
create trigger training_releases_touch before update on public.training_releases
  for each row execute function app.touch_updated_at();
create trigger training_lesson_progress_touch before update on public.training_lesson_progress
  for each row execute function app.touch_updated_at();

-- RLS ----------------------------------------------------------------------

alter table public.workforce_roles enable row level security;
alter table public.workforce_profiles enable row level security;
alter table public.workforce_role_assignments enable row level security;
alter table public.calendar_categories enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.calendar_entry_assignments enable row level security;
alter table public.availability_blockouts enable row level security;
alter table public.training_bootstrap_runs enable row level security;
alter table public.training_releases enable row level security;
alter table public.training_lesson_progress enable row level security;
alter table public.training_quiz_attempts enable row level security;

create policy workforce_roles_select on public.workforce_roles for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy workforce_roles_insert on public.workforce_roles for insert to authenticated
  with check (app.is_brand_owner(brand_id));
create policy workforce_roles_update on public.workforce_roles for update to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy workforce_roles_delete on public.workforce_roles for delete to authenticated
  using (app.is_brand_owner(brand_id));

create policy workforce_profiles_select on public.workforce_profiles for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy workforce_profiles_insert on public.workforce_profiles for insert to authenticated
  with check (app.is_brand_owner(brand_id));
create policy workforce_profiles_update on public.workforce_profiles for update to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy workforce_profiles_delete on public.workforce_profiles for delete to authenticated
  using (app.is_brand_owner(brand_id));

create policy workforce_role_assignments_select on public.workforce_role_assignments
  for select to authenticated using (app.is_brand_staff(brand_id));
create policy workforce_role_assignments_insert on public.workforce_role_assignments
  for insert to authenticated with check (app.is_brand_owner(brand_id));
create policy workforce_role_assignments_update on public.workforce_role_assignments
  for update to authenticated using (app.is_brand_owner(brand_id))
  with check (app.is_brand_owner(brand_id));
create policy workforce_role_assignments_delete on public.workforce_role_assignments
  for delete to authenticated using (app.is_brand_owner(brand_id));

create policy calendar_categories_select on public.calendar_categories for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy calendar_categories_insert on public.calendar_categories for insert to authenticated
  with check (app.is_brand_owner(brand_id));
create policy calendar_categories_update on public.calendar_categories for update to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy calendar_categories_delete on public.calendar_categories for delete to authenticated
  using (app.is_brand_owner(brand_id));

create policy calendar_entries_select on public.calendar_entries for select to authenticated
  using (app.calendar_row_visible(brand_id, location_id));
create policy calendar_entries_insert on public.calendar_entries for insert to authenticated
  with check (
    app.is_current_brand_user(brand_id, created_by)
    and (
      (location_id is null and app.is_brand_owner(brand_id))
      or (location_id is not null and app.manages_location(brand_id, location_id))
    )
  );
create policy calendar_entries_update on public.calendar_entries for update to authenticated
  using (
    (location_id is null and app.is_brand_owner(brand_id))
    or (location_id is not null and app.manages_location(brand_id, location_id))
  )
  with check (
    (location_id is null and app.is_brand_owner(brand_id))
    or (location_id is not null and app.manages_location(brand_id, location_id))
  );
create policy calendar_entries_delete on public.calendar_entries for delete to authenticated
  using (
    (location_id is null and app.is_brand_owner(brand_id))
    or (location_id is not null and app.manages_location(brand_id, location_id))
  );

create policy calendar_entry_assignments_select on public.calendar_entry_assignments
  for select to authenticated using (
    exists (
      select 1 from public.calendar_entries entry
      where entry.id = calendar_entry_id
        and entry.brand_id = calendar_entry_assignments.brand_id
        and app.calendar_row_visible(entry.brand_id, entry.location_id)
    )
  );
create policy calendar_entry_assignments_insert on public.calendar_entry_assignments
  for insert to authenticated with check (
    exists (
      select 1 from public.calendar_entries entry
      where entry.id = calendar_entry_id
        and entry.brand_id = calendar_entry_assignments.brand_id
        and ((entry.location_id is null and app.is_brand_owner(entry.brand_id))
          or (entry.location_id is not null
            and app.manages_location(entry.brand_id, entry.location_id)))
        and exists (
          select 1 from public.brand_users member
          where member.id = calendar_entry_assignments.brand_user_id
            and member.brand_id = calendar_entry_assignments.brand_id
            and (entry.location_id is null
              or entry.location_id = any (member.location_ids))
        )
    )
  );
create policy calendar_entry_assignments_update on public.calendar_entry_assignments
  for update to authenticated
  using (
    exists (
      select 1 from public.calendar_entries entry
      where entry.id = calendar_entry_id
        and entry.brand_id = calendar_entry_assignments.brand_id
        and ((entry.location_id is null and app.is_brand_owner(entry.brand_id))
          or (entry.location_id is not null
            and app.manages_location(entry.brand_id, entry.location_id)))
    )
  )
  with check (
    exists (
      select 1 from public.calendar_entries entry
      where entry.id = calendar_entry_id
        and entry.brand_id = calendar_entry_assignments.brand_id
        and ((entry.location_id is null and app.is_brand_owner(entry.brand_id))
          or (entry.location_id is not null
            and app.manages_location(entry.brand_id, entry.location_id)))
    )
  );
create policy calendar_entry_assignments_delete on public.calendar_entry_assignments
  for delete to authenticated using (
    exists (
      select 1 from public.calendar_entries entry
      where entry.id = calendar_entry_id
        and entry.brand_id = calendar_entry_assignments.brand_id
        and ((entry.location_id is null and app.is_brand_owner(entry.brand_id))
          or (entry.location_id is not null
            and app.manages_location(entry.brand_id, entry.location_id)))
    )
  );

create policy availability_blockouts_select on public.availability_blockouts
  for select to authenticated using (
    app.is_brand_owner(brand_id)
    or (brand_user_id is not null and exists (
      select 1 from public.brand_users member
      where member.id = brand_user_id and member.user_id = (select auth.uid())
    ))
    or (status = 'approved'
      and scope_kind <> 'person'
      and app.calendar_row_visible(brand_id, location_id))
    or (location_id is not null and app.manages_location(brand_id, location_id))
  );
create policy availability_blockouts_insert on public.availability_blockouts
  for insert to authenticated with check (
    (scope_kind = 'person'
      and location_id is not null
      and status = 'requested'
      and reviewed_by is null
      and brand_user_id = requested_by
      and app.is_current_brand_user(brand_id, requested_by)
      and app.at_location(brand_id, location_id))
    or (scope_kind = 'brand'
      and status = 'approved'
      and app.is_brand_owner(brand_id)
      and app.is_current_brand_user(brand_id, requested_by)
      and app.is_current_brand_user(brand_id, reviewed_by))
    or (scope_kind <> 'brand' and location_id is not null
      and status = 'approved'
      and app.manages_location(brand_id, location_id)
      and app.is_current_brand_user(brand_id, requested_by)
      and app.is_current_brand_user(brand_id, reviewed_by)
      and (brand_user_id is null or exists (
        select 1 from public.brand_users member
        where member.id = brand_user_id
          and member.brand_id = availability_blockouts.brand_id
          and location_id = any (member.location_ids)
      )))
  );
create policy availability_blockouts_update on public.availability_blockouts
  for update to authenticated
  using (
    app.is_brand_owner(brand_id)
    or (location_id is not null and app.manages_location(brand_id, location_id))
    or (status = 'requested' and exists (
      select 1 from public.brand_users member
      where member.id = brand_user_id
        and member.id = requested_by
        and member.user_id = (select auth.uid())
    ))
  )
  with check (
    (app.is_brand_owner(brand_id)
      and (status not in ('approved', 'declined')
        or app.is_current_brand_user(brand_id, reviewed_by)))
    or (location_id is not null
      and app.manages_location(brand_id, location_id)
      and (status not in ('approved', 'declined')
        or app.is_current_brand_user(brand_id, reviewed_by)))
    or (scope_kind = 'person'
      and status in ('requested', 'withdrawn')
      and reviewed_by is null
      and exists (
        select 1 from public.brand_users member
        where member.id = brand_user_id
          and member.id = requested_by
          and member.user_id = (select auth.uid())
          and member.brand_id = availability_blockouts.brand_id
      ))
  );

create policy training_bootstrap_runs_select on public.training_bootstrap_runs
  for select to authenticated using (app.is_brand_owner(brand_id));

create policy training_releases_select on public.training_releases
  for select to authenticated using (
    (status = 'published' and app.is_brand_staff(brand_id))
    or app.is_brand_owner(brand_id)
  );

create policy training_lesson_progress_select on public.training_lesson_progress
  for select to authenticated using (
    app.is_current_brand_user(brand_id, brand_user_id)
    or app.is_brand_owner(brand_id)
  );
create policy training_quiz_attempts_select on public.training_quiz_attempts
  for select to authenticated using (
    app.is_current_brand_user(brand_id, brand_user_id)
    or app.is_brand_owner(brand_id)
  );

-- Privileges are explicit even though 0014 has defaults: future Supabase
-- projects no longer expose public tables automatically.
revoke all on table
  public.workforce_roles,
  public.workforce_profiles,
  public.workforce_role_assignments,
  public.calendar_categories,
  public.calendar_entries,
  public.calendar_entry_assignments,
  public.availability_blockouts,
  public.training_bootstrap_runs,
  public.training_releases
  , public.training_lesson_progress,
  public.training_quiz_attempts
from anon, authenticated;

grant select, insert, update, delete on table
  public.workforce_roles,
  public.workforce_profiles,
  public.workforce_role_assignments,
  public.calendar_categories,
  public.calendar_entries,
  public.calendar_entry_assignments
to authenticated;

grant select, insert, update on table public.availability_blockouts to authenticated;
grant select on table public.training_bootstrap_runs to authenticated;
grant select (
  id, brand_id, bootstrap_run_id, version, status, manifest,
  validated_at, published_at, created_at, updated_at
) on public.training_releases to authenticated;
grant select on table public.training_lesson_progress to authenticated;
grant select on table public.training_quiz_attempts to authenticated;

grant all on table
  public.workforce_roles,
  public.workforce_profiles,
  public.workforce_role_assignments,
  public.calendar_categories,
  public.calendar_entries,
  public.calendar_entry_assignments,
  public.availability_blockouts,
  public.training_bootstrap_runs,
  public.training_releases
  , public.training_lesson_progress,
  public.training_quiz_attempts
to service_role;
