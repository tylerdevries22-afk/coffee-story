-- Managers can inspect prior thumbnails and lesson media, but only the
-- service-role-backed HQ actions can write the immutable history ledger.
drop policy if exists content_media_versions_select on public.content_media_versions;
create policy content_media_versions_select on public.content_media_versions
  for select to authenticated
  using (app.is_brand_manager(brand_id));

revoke insert, update, delete on public.content_media_versions from anon, authenticated;
grant select on public.content_media_versions to authenticated;
