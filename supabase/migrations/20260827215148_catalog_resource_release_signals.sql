create or replace function app.bump_catalog_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_catalog uuid;
begin
  target_catalog := coalesce(new.catalog_id, old.catalog_id);
  update public.catalogs set draft_version = draft_version + 1, updated_at = now()
  where id = target_catalog;
  return coalesce(new, old);
end $$;

revoke all on function app.bump_catalog_draft() from public;
create trigger catalog_resources_bump_draft after insert or update or delete on public.catalog_resources
  for each row execute function app.bump_catalog_draft();
create trigger catalog_relations_bump_draft after insert or update or delete on public.catalog_relations
  for each row execute function app.bump_catalog_draft();

insert into public.content_media_versions (
  brand_id, family, entity_type, entity_key, slot, public_url, metadata
)
select category.brand_id, 'menu', 'catalog_folder', category.id::text,
  'thumbnail', category.image_url, jsonb_build_object('source', 'catalog-backfill')
from public.menu_categories category
where category.image_url is not null and category.image_url ~ '^https://'
on conflict do nothing;
