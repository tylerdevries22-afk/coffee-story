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

/**
 * The menu, as it changes under a running screen.
 *
 * It lives beside the read rather than in `realtime.ts` because
 * `surfaces.test.ts` attributes a module's relations to every export from it,
 * and `realtime.ts` also carries the order subscriptions -- so a kiosk
 * importing a menu subscription from there read as a kiosk that could reach
 * `orders`. Splitting the module was the fix; widening the allowlist would
 * have been the bug.
 *
 * Migration 0027 put `menu_items`, `menu_categories` and `drops` in the
 * publication with the stated intent that "a change made once should appear on
 * every kiosk and display at once". Until this existed, nothing subscribed:
 * 86'ing an item reached no screen, and a guest could order something the shop
 * ran out of an hour earlier.
 *
 * It reports THAT the menu changed, not what changed. A menu is a tree
 * assembled from three tables — an item moving category, a category being
 * reordered and a drop opening are all edits to the same picture — so
 * patching rows individually means reimplementing `fetchMenuTree`'s assembly
 * in a second place. The caller refetches, which is one round trip on an edit
 * that happens a few times a day.
 *
 * Bursts are coalesced: re-pricing a category is one edit to a manager and
 * twenty messages on the wire.
 */
export function subscribeToMenu(
  client: SupabaseClient | null,
  brandId: string,
  onChanged: () => void,
  settleMs = 400,
): () => void {
  if (!client) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = true;
  const settle = () => {
    if (!live) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (live) onChanged();
    }, settleMs);
  };
  const filter = `brand_id=eq.${brandId}`;
  const channel = client.channel(`menu-${brandId}`);
  for (const table of ['menu_items', 'menu_categories', 'drops'] as const) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, settle);
  }
  channel.subscribe();
  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
