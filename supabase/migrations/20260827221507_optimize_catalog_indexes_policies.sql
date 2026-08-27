create index if not exists catalog_audit_events_brand_fk_idx on public.catalog_audit_events (brand_id);
create index if not exists catalog_audit_events_catalog_brand_fk_idx on public.catalog_audit_events (catalog_id, brand_id);
create index if not exists catalog_audit_events_release_fk_idx on public.catalog_audit_events (release_id);
create index if not exists catalog_nodes_catalog_brand_fk_idx on public.catalog_nodes (catalog_id, brand_id);
create index if not exists catalog_nodes_commerce_catalog_brand_fk_idx on public.catalog_nodes (commerce_item_id, catalog_id, brand_id);
create index if not exists catalog_placements_brand_fk_idx on public.catalog_placements (brand_id);
create index if not exists catalog_placements_catalog_brand_fk_idx on public.catalog_placements (catalog_id, brand_id);
create index if not exists catalog_placements_node_catalog_brand_fk_idx on public.catalog_placements (node_id, catalog_id, brand_id);
create index if not exists catalog_placements_parent_catalog_brand_fk_idx on public.catalog_placements (parent_id, catalog_id, brand_id);
create index if not exists catalog_publications_catalog_brand_fk_idx on public.catalog_publications (catalog_id, brand_id);
create index if not exists catalog_publications_release_catalog_brand_fk_idx on public.catalog_publications (release_id, catalog_id, brand_id);
create index if not exists catalog_relations_catalog_brand_fk_idx on public.catalog_relations (catalog_id, brand_id);
create index if not exists catalog_release_private_brand_fk_idx on public.catalog_release_private (brand_id);
create index if not exists catalog_release_private_release_brand_fk_idx on public.catalog_release_private (release_id, brand_id);
create index if not exists catalog_releases_catalog_brand_fk_idx on public.catalog_releases (catalog_id, brand_id);
create index if not exists catalog_releases_creator_brand_fk_idx on public.catalog_releases (created_by, brand_id);
create index if not exists catalog_resources_catalog_brand_fk_idx on public.catalog_resources (catalog_id, brand_id);

drop policy if exists catalog_templates_admin on public.catalog_templates;
create policy catalog_templates_admin_insert on public.catalog_templates for insert to authenticated
  with check (app.is_platform_admin());
create policy catalog_templates_admin_update on public.catalog_templates for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy catalog_templates_admin_delete on public.catalog_templates for delete to authenticated
  using (app.is_platform_admin());
