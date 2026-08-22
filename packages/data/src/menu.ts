import type { SupabaseClient } from '@supabase/supabase-js';

import type { DropRow, MenuCategoryRow, MenuItemRow } from '@platform/schema';

export type MenuTreeItem = MenuItemRow;

export type MenuTreeCategory = MenuCategoryRow & {
  items: MenuTreeItem[];
};

export type MenuTree = {
  menuId: string | null;
  categories: MenuTreeCategory[];
  drops: DropRow[];
};

/**
 * The published menu as the storefront renders it: categories in sort order,
 * each carrying its listed items in sort order, plus the drops board. RLS
 * limits an anonymous read to published menus, so "what the guest sees" is
 * the policy, not a client-side filter — except is_listed, which staff can
 * flip intraday and clients honour here.
 */
export async function fetchMenuTree(client: SupabaseClient, brandId: string): Promise<MenuTree> {
  const [categories, items, drops] = await Promise.all([
    client
      .from('menu_categories')
      .select('*')
      .eq('brand_id', brandId)
      .order('sort_order')
      .returns<MenuCategoryRow[]>(),
    client
      .from('menu_items')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_listed', true)
      .order('sort_order')
      .returns<MenuItemRow[]>(),
    client
      .from('drops')
      .select('*')
      .eq('brand_id', brandId)
      .in('status', ['scheduled', 'live', 'ended'])
      .order('starts_at', { ascending: false })
      .returns<DropRow[]>(),
  ]);
  if (categories.error) throw new Error(`fetchMenuTree categories: ${categories.error.message}`);
  if (items.error) throw new Error(`fetchMenuTree items: ${items.error.message}`);
  if (drops.error) throw new Error(`fetchMenuTree drops: ${drops.error.message}`);

  const byCategory = new Map<string, MenuTreeItem[]>();
  for (const item of items.data ?? []) {
    const bucket = byCategory.get(item.category_id) ?? [];
    bucket.push(item);
    byCategory.set(item.category_id, bucket);
  }
  const tree = (categories.data ?? []).map((category) => ({
    ...category,
    items: byCategory.get(category.id) ?? [],
  }));
  return {
    menuId: categories.data?.[0]?.menu_id ?? null,
    categories: tree,
    drops: drops.data ?? [],
  };
}
