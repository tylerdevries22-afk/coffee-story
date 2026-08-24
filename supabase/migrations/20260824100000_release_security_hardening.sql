-- Final release hardening for media uploads, privileged function resolution,
-- and the indexes used by realtime signal policies.

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/avif']::text[]
where id in ('brand-assets', 'menu-images');

-- These functions fully qualify application relations. An empty search path
-- prevents a caller-controlled object from shadowing an unqualified helper.
alter function public.loyalty_spend(uuid, bigint) set search_path = '';
alter function public.loyalty_adjust(uuid, bigint) set search_path = '';
alter function public.mark_order_arrived(uuid) set search_path = '';
alter function public.set_brand_settings_config(jsonb, timestamptz) set search_path = '';
alter function app.signal_board_change() set search_path = '';
alter function app.signal_location_setting_change() set search_path = '';

create index board_change_signals_brand_idx
  on public.board_change_signals (brand_id);
create index location_setting_signals_brand_idx
  on public.location_setting_signals (brand_id);

alter view public.location_daily_metrics set (security_barrier = true);
revoke all on public.location_daily_metrics from anon;
