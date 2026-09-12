import type { SupabaseClient } from '@supabase/supabase-js';

import type { ValidatedTenant } from './onboard-validation.js';
import { syncMenuImage } from '../onboard-menu-images.js';

function requiredId(ids: ReadonlyMap<string, string>, key: string, label: string): string {
  const id = ids.get(key);
  if (!id) throw new Error(`No database ${label} was created for "${key}".`);
  return id;
}

export async function seedTenantMenu(
  db: SupabaseClient, brandId: string, tenantDir: string, tenant: ValidatedTenant,
): Promise<number> {
  if (tenant.menuRows.length === 0) return 0;
  const { data: savedMenu, error: menuError } = await db.from('menus').upsert(
    { brand_id: brandId, name: 'Menu', is_published: true },
    { onConflict: 'brand_id,name' },
  ).select('id').single();
  if (menuError) throw menuError;
  const categoryIds = new Map<string, string>();
  for (const [index, category] of tenant.menu.categories.entries()) {
    const { data, error } = await db.from('menu_categories').upsert({
      brand_id: brandId, menu_id: savedMenu.id, slug: category.id,
      title: category.title, tagline: category.tagline, sort_order: index,
    }, { onConflict: 'menu_id,title' }).select('id').single();
    if (error) throw error;
    categoryIds.set(category.title, data.id);
  }
  const compiled = new Map(tenant.menu.items.map((item) => [item.id, item]));
  const itemIds = new Map<string, string>();
  let uploaded = 0;
  for (const [index, row] of tenant.menuRows.entries()) {
    const item = compiled.get(row.slug);
    if (!item) throw new Error(`No compiled menu item for "${row.slug}".`);
    const { data, error } = await db.from('menu_items').upsert({
      brand_id: brandId, menu_id: savedMenu.id,
      category_id: requiredId(categoryIds, row.category, 'category'),
      slug: row.slug, name: row.name, description: row.description,
      base_price_cents: row.basePriceCents, sizes: row.sizes,
      modifiers: tenant.modifiers[row.slug] ?? [], sort_order: index,
      pack_size: item.packSize ?? null, choice_source: item.choiceSource ?? null,
      pack_choice_slugs: item.eligibleItemIds ?? [], single_item_id: null,
      // Explicit, so an item that left the CSV and came back is listed again
      // rather than keeping whatever the retire pass below left it with.
      is_listed: true,
    }, { onConflict: 'menu_id,slug' }).select('id,slug').single();
    if (error) throw error;
    itemIds.set(data.slug, data.id);
    if (await syncMenuImage(db, brandId, data.id, data.slug, tenantDir)) uploaded += 1;
  }
  // Onboarding is documented as idempotent, and it was -- for additions. An
  // item removed from menu.csv stayed exactly as it was, and the guest menu
  // reads `is_listed`, so a discontinued drink was orderable indefinitely
  // after the tenant took it off their menu. Unlist rather than delete:
  // order history references these rows, and unlisting is what the storefront
  // actually keys on.
  const { error: retireError } = await db.from('menu_items')
    .update({ is_listed: false })
    .eq('brand_id', brandId)
    .eq('menu_id', savedMenu.id)
    .not('slug', 'in', `(${tenant.menuRows.map((row) => `"${row.slug}"`).join(',')})`);
  if (retireError) throw retireError;
  for (const item of tenant.menu.items) {
    if (!item.singleItemId) continue;
    const { error } = await db.from('menu_items')
      .update({ single_item_id: requiredId(itemIds, item.singleItemId, 'menu item') })
      .eq('id', requiredId(itemIds, item.id, 'menu item'));
    if (error) throw error;
  }
  return uploaded;
}
