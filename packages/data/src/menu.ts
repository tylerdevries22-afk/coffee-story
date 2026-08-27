import type { SupabaseClient } from '@supabase/supabase-js';

import {
  requireSinglePublishedMenuId,
  type DropRow,
  type MenuCategoryRow,
  type MenuItemRow,
} from '@platform/schema';
import type { CatalogManifest, CatalogOffering } from '@platform/domain';

import { readWithRetry } from './read-retry';
import { fetchPublishedCatalog } from './catalog';

export type MenuTreeItem = MenuItemRow;

export type MenuTreeCategory = MenuCategoryRow & {
  items: MenuTreeItem[];
  parentId?: string | null;
};

export type MenuTree = {
  menuId: string | null;
  categories: MenuTreeCategory[];
  drops: DropRow[];
  catalog?: CatalogManifest;
};

/**
 * The published menu as the storefront renders it: categories in sort order,
 * each carrying its listed items in sort order, plus the drops board. RLS
 * limits an anonymous read to published menus, so "what the guest sees" is
 * the policy, not a client-side filter — except is_listed, which staff can
 * flip intraday and clients honour here.
 */
export async function fetchMenuTree(client: SupabaseClient, brandId: string): Promise<MenuTree> {
  const menus = await readWithRetry('fetchMenuTree published menu', (signal) => client
    .from('menus')
    .select('id')
    .eq('brand_id', brandId)
    .eq('is_published', true)
    .abortSignal(signal)
    .returns<{ id: string }[]>());
  const menuId = requireSinglePublishedMenuId(menus ?? []);
  const [categories, items, drops, catalogRelease] = await Promise.all([
    readWithRetry('fetchMenuTree categories', (signal) => client
      .from('menu_categories')
      .select('*')
      .eq('brand_id', brandId)
      .eq('menu_id', menuId)
      .order('sort_order')
      .abortSignal(signal)
      .returns<MenuCategoryRow[]>()),
    readWithRetry('fetchMenuTree items', (signal) => client
      .from('menu_items')
      .select('*')
      .eq('brand_id', brandId)
      .eq('menu_id', menuId)
      .eq('is_listed', true)
      .order('sort_order')
      .abortSignal(signal)
      .returns<MenuItemRow[]>()),
    readWithRetry('fetchMenuTree drops', (signal) => client
      .from('drops')
      .select('*')
      .eq('brand_id', brandId)
      .in('status', ['scheduled', 'live', 'ended'])
      .order('starts_at', { ascending: false })
      .abortSignal(signal)
      .returns<DropRow[]>()),
    fetchPublishedCatalog(client, brandId, 'public').catch(() => null),
  ]);

  if (catalogRelease) {
    const folderNodes = new Map(catalogRelease.manifest.nodes.filter((node) => node.kind === 'folder').map((node) => [node.id, node]));
    const offeringNodes = new Map(catalogRelease.manifest.nodes
      .filter((node): node is CatalogOffering => node.kind === 'offering')
      .map((node) => [node.commerceItemId, node]));
    const primary = new Map(catalogRelease.manifest.placements.filter((placement) => placement.isPrimary).map((placement) => [placement.nodeId, placement]));
    const placementsByNode = new Map<string, typeof catalogRelease.manifest.placements>();
    for (const placement of catalogRelease.manifest.placements) {
      placementsByNode.set(placement.nodeId, [...(placementsByNode.get(placement.nodeId) ?? []), placement]);
    }
    const releasedItems = (items ?? []).filter((item) => offeringNodes.has(item.id)).map((item) => {
      const offering = offeringNodes.get(item.id);
      if (!offering) return item;
      return {
        ...item, name: offering.title, slug: offering.slug, description: offering.description,
        image_url: offering.imageUrl, category_id: primary.get(offering.id)?.parentId ?? item.category_id,
        base_price_cents: offering.commerce.basePriceCents,
        sizes: offering.commerce.sizes, modifiers: offering.commerce.optionGroups,
        availability: offering.commerce.availability, is_listed: offering.commerce.isListed,
      };
    }).filter((item) => item.is_listed);
    const byFolder = new Map<string, MenuTreeItem[]>();
    for (const item of releasedItems) {
      const offering = offeringNodes.get(item.id);
      const folderIds = new Set((offering ? placementsByNode.get(offering.id) : undefined)
        ?.map((placement) => placement.parentId).filter((parentId): parentId is string => Boolean(parentId))
        ?? [item.category_id]);
      for (const folderId of folderIds) byFolder.set(folderId, [...(byFolder.get(folderId) ?? []), item]);
    }
    const releasedCategories = (categories ?? []).filter((category) => folderNodes.has(category.id)).map((category) => {
      const folder = folderNodes.get(category.id);
      return {
        ...category, title: folder?.title ?? category.title, tagline: folder?.description ?? category.tagline,
        items: byFolder.get(category.id) ?? [], parentId: primary.get(category.id)?.parentId ?? null,
      };
    });
    const itemIds = new Set(releasedItems.map((item) => item.id));
    return {
      menuId, categories: releasedCategories,
      drops: (drops ?? []).filter((drop) => itemIds.has(drop.item_id)),
      catalog: catalogRelease.manifest,
    };
  }

  const byCategory = new Map<string, MenuTreeItem[]>();
  for (const item of items ?? []) {
    const bucket = byCategory.get(item.category_id) ?? [];
    bucket.push(item);
    byCategory.set(item.category_id, bucket);
  }
  const tree = (categories ?? []).map((category) => ({
    ...category,
    items: byCategory.get(category.id) ?? [],
  }));
  const itemIds = new Set((items ?? []).map((item) => item.id));
  return {
    menuId,
    categories: tree,
    drops: (drops ?? []).filter((drop) => itemIds.has(drop.item_id)),
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
  const channel = client
    .channel(`menu-${brandId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items', filter }, settle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_categories', filter }, settle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'drops', filter }, settle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_publications', filter }, settle)
    .subscribe();
  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
