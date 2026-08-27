create trigger catalog_alias_placements_insert_bump_draft
after insert on public.catalog_placements
for each row when (not new.is_primary) execute function app.bump_catalog_draft();
create trigger catalog_alias_placements_update_bump_draft
after update on public.catalog_placements
for each row when (not new.is_primary or not old.is_primary) execute function app.bump_catalog_draft();
create trigger catalog_alias_placements_delete_bump_draft
after delete on public.catalog_placements
for each row when (not old.is_primary) execute function app.bump_catalog_draft();

create trigger catalog_node_archive_bump_draft
after update of archived_at on public.catalog_nodes
for each row when (old.archived_at is distinct from new.archived_at)
execute function app.bump_catalog_draft();
