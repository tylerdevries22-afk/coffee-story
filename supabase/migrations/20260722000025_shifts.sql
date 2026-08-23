-- 0025: shifts and the crew's checklists.
--
-- The crew surface is the one staff screen that is personal rather than
-- device-paired: it shows who is on, and it attributes completed work to a
-- name. So there is no device role here at all -- only signed-in staff.

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  brand_user_id uuid not null references public.brand_users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shifts_roster_idx on public.shifts (location_id, starts_at);
create index shifts_brand_idx on public.shifts (brand_id);

create type app.task_recurrence as enum ('opening', 'closing', 'daily', 'weekly');

-- The template: what has to happen, every time.
create table public.crew_tasks (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid references public.locations (id) on delete cascade,
  title text not null,
  detail text not null default '',
  recurrence app.task_recurrence not null default 'daily',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crew_tasks_list_idx on public.crew_tasks (brand_id, recurrence, sort_order);

-- One row per task per day: the completion, not the task. Separating them is
-- what lets a checklist be edited without rewriting yesterday's record of who
-- did what.
create table public.crew_task_completions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  task_id uuid not null references public.crew_tasks (id) on delete cascade,
  service_date date not null,
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz not null default now(),
  unique (task_id, location_id, service_date)
);

create index crew_completions_day_idx
  on public.crew_task_completions (location_id, service_date);

create trigger shifts_touch before update on public.shifts
  for each row execute function app.touch_updated_at();
create trigger crew_tasks_touch before update on public.crew_tasks
  for each row execute function app.touch_updated_at();

-- RLS ---------------------------------------------------------------------

alter table public.shifts enable row level security;
alter table public.crew_tasks enable row level security;
alter table public.crew_task_completions enable row level security;

-- Staff see the roster for locations they work at; owners see the brand's.
create policy shifts_select on public.shifts for select
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));
create policy shifts_write on public.shifts for insert
  with check (app.is_brand_owner(brand_id) or app.at_location(brand_id, location_id));
create policy shifts_update on public.shifts for update
  using (app.is_brand_owner(brand_id) or app.at_location(brand_id, location_id))
  with check (app.is_brand_owner(brand_id) or app.at_location(brand_id, location_id));
create policy shifts_delete on public.shifts for delete
  using (app.is_brand_owner(brand_id));

create policy crew_tasks_select on public.crew_tasks for select
  using (app.is_brand_staff(brand_id));
create policy crew_tasks_write on public.crew_tasks for insert
  with check (app.is_brand_owner(brand_id));
create policy crew_tasks_update on public.crew_tasks for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy crew_tasks_delete on public.crew_tasks for delete
  using (app.is_brand_owner(brand_id));

create policy crew_completions_select on public.crew_task_completions for select
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));
-- Attribution is the point: a completion records the person who tapped it, so
-- it must be their own auth.uid() and not a name they typed.
create policy crew_completions_insert on public.crew_task_completions for insert
  with check (app.at_location(brand_id, location_id) and completed_by = auth.uid());
create policy crew_completions_delete on public.crew_task_completions for delete
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));

grant select on public.crew_tasks to authenticated;
grant select, insert, update, delete on public.shifts to authenticated;
grant select, insert, delete on public.crew_task_completions to authenticated;
