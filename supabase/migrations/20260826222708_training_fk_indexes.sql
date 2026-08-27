-- Covering indexes for every composite training foreign key. These keep
-- tenant-scoped release, progress, quiz, and realtime-event lookups fast as
-- franchise history grows.

create index if not exists training_bootstrap_runs_requested_by_fk_idx
  on public.training_bootstrap_runs (requested_by, brand_id)
  where requested_by is not null;

create index if not exists training_releases_bootstrap_run_fk_idx
  on public.training_releases (bootstrap_run_id, brand_id)
  where bootstrap_run_id is not null;

create index if not exists training_releases_created_by_fk_idx
  on public.training_releases (created_by, brand_id)
  where created_by is not null;

create index if not exists training_releases_updated_by_fk_idx
  on public.training_releases (updated_by, brand_id)
  where updated_by is not null;

create index if not exists training_lesson_progress_release_fk_idx
  on public.training_lesson_progress (release_id, brand_id);

create index if not exists training_lesson_progress_brand_user_fk_idx
  on public.training_lesson_progress (brand_user_id, brand_id);

create index if not exists training_quiz_attempts_brand_fk_idx
  on public.training_quiz_attempts (brand_id);

create index if not exists training_quiz_attempts_release_fk_idx
  on public.training_quiz_attempts (release_id, brand_id);

create index if not exists training_quiz_attempts_brand_user_fk_idx
  on public.training_quiz_attempts (brand_user_id, brand_id);

create index if not exists training_release_events_release_fk_idx
  on public.training_release_events (release_id, brand_id);
