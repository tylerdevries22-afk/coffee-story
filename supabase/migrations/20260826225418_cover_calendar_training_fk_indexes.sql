-- Cover the remaining tenant-scoped foreign keys reported by Supabase's
-- performance advisor. Composite keys keep deletes and joins from scanning
-- every franchise row while preserving the existing range/query indexes.

create index if not exists availability_blockouts_brand_user_fk_idx
  on public.availability_blockouts (brand_user_id, brand_id)
  where brand_user_id is not null;

create index if not exists availability_blockouts_location_fk_idx
  on public.availability_blockouts (location_id, brand_id)
  where location_id is not null;

create index if not exists availability_blockouts_requested_by_fk_idx
  on public.availability_blockouts (requested_by, brand_id)
  where requested_by is not null;

create index if not exists availability_blockouts_reviewed_by_fk_idx
  on public.availability_blockouts (reviewed_by, brand_id)
  where reviewed_by is not null;

create index if not exists calendar_entries_category_fk_idx
  on public.calendar_entries (category_id, brand_id);

create index if not exists calendar_entries_created_by_fk_idx
  on public.calendar_entries (created_by, brand_id)
  where created_by is not null;

create index if not exists calendar_entries_location_fk_idx
  on public.calendar_entries (location_id, brand_id)
  where location_id is not null;

create index if not exists calendar_entry_assignments_brand_fk_idx
  on public.calendar_entry_assignments (brand_id);

create index if not exists calendar_entry_assignments_brand_user_fk_idx
  on public.calendar_entry_assignments (brand_user_id, brand_id);

create index if not exists calendar_entry_assignments_entry_fk_idx
  on public.calendar_entry_assignments (calendar_entry_id, brand_id);

create index if not exists calendar_entry_assignments_role_fk_idx
  on public.calendar_entry_assignments (workforce_role_id, brand_id);

create index if not exists content_media_versions_created_by_fk_idx
  on public.content_media_versions (created_by, brand_id)
  where created_by is not null;

create index if not exists workforce_profiles_brand_fk_idx
  on public.workforce_profiles (brand_id);

create index if not exists workforce_profiles_brand_user_fk_idx
  on public.workforce_profiles (brand_user_id, brand_id);

create index if not exists workforce_role_assignments_brand_fk_idx
  on public.workforce_role_assignments (brand_id);

create index if not exists workforce_role_assignments_brand_user_fk_idx
  on public.workforce_role_assignments (brand_user_id, brand_id);

create index if not exists workforce_role_assignments_location_fk_idx
  on public.workforce_role_assignments (location_id, brand_id);

create index if not exists workforce_role_assignments_role_fk_idx
  on public.workforce_role_assignments (workforce_role_id, brand_id);
