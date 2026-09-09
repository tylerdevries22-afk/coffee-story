import type { KioskMenuFacts } from '@platform/domain';

import { DEMO_KIOSK_FLOW, DEMO_KIOSK_MENU } from './demo-data';
import { serverClient } from './supabase-server';
import { liveScope } from './live-scope';
import { demoFixture } from './data-shared';

export type KioskConfigView = {
  /** The raw `brand_config.kiosk`, or null when the brand has none. */
  kiosk: unknown;
  /** What the resolver needs to tell a live tile from a dead one. */
  menu: KioskMenuFacts;
  /** For optimistic concurrency on save; null when unknown. */
  updatedAt: string | null;
};

export type BrandConfigView = {
  config: unknown;
  updatedAt: string | null;
};

/** Current settings and row version for the concurrency-safe brand editor. */
export async function loadBrandConfig(): Promise<BrandConfigView> {
  const client = await serverClient();
  if (!client) return { config: null, updatedAt: null };
  const scope = await liveScope(client);
  if (!scope.orgId) return { config: null, updatedAt: null };
  const result = await client.from('brands').select('brand_config, updated_at').eq('id', scope.orgId).maybeSingle<{
    brand_config: unknown;
    updated_at: string;
  }>();
  if (result.error) throw new Error(`brands: ${result.error.message}`);
  return { config: result.data?.brand_config ?? null, updatedAt: result.data?.updated_at ?? null };
}

/**
 * The kiosk flow, plus enough of the menu to validate it against.
 *
 * The menu is loaded because `resolveKioskFlow` drops a tile pointing at a
 * category that no longer exists. Categories
 * are keyed by TITLE because `menu_categories` (0003) has no slug and a uuid
 * differs per environment, so a title is the only thing a tenant file can name
 * a category by.
 */
export async function loadKioskConfig(): Promise<KioskConfigView> {
  const client = await serverClient();
  if (!client) return demoFixture(
    { kiosk: DEMO_KIOSK_FLOW, menu: DEMO_KIOSK_MENU, updatedAt: null },
    { kiosk: null, menu: { categories: [], itemSlugs: [] }, updatedAt: null },
  );
  const scope = await liveScope(client);
  if (!scope.orgId) throw new Error('brands: no tenant in scope');

  const brand = await client.from('brands').select('id, brand_config, updated_at').eq('id', scope.orgId).maybeSingle<{
    id: string;
    brand_config: Record<string, unknown> | null;
    updated_at: string;
  }>();
  if (brand.error) throw new Error(`brands: ${brand.error.message}`);
  const brandRow = brand.data;
  const brandId = brandRow?.id;
  if (!brandId) throw new Error('brands: no tenant in scope');
  const publishedMenu = await client.from('menus').select('id').eq('brand_id', brandId)
    .eq('is_published', true).maybeSingle<{ id: string }>();
  if (publishedMenu.error) throw new Error(`menus: ${publishedMenu.error.message}`);
  const menuId = publishedMenu.data?.id;
  if (!menuId) {
    return {
      kiosk: brandRow.brand_config?.kiosk ?? null,
      menu: { categories: [], itemSlugs: [] },
      updatedAt: brandRow.updated_at ?? null,
    };
  }
  const [categories, items] = await Promise.all([
    client.from('menu_categories').select('title').eq('brand_id', brandId).eq('menu_id', menuId).returns<{ title: string }[]>(),
    client.from('menu_items').select('slug, image_url').eq('brand_id', brandId).eq('menu_id', menuId).returns<{ slug: string; image_url: string | null }[]>(),
  ]);
  if (categories.error) throw new Error(`menu_categories: ${categories.error.message}`);
  if (items.error) throw new Error(`menu_items: ${items.error.message}`);

  return {
    kiosk: brandRow.brand_config?.kiosk ?? null,
    menu: {
      categories: (categories.data ?? []).map((row) => ({ id: row.title, title: row.title })),
      itemSlugs: (items.data ?? []).map((row) => row.slug),
      ...(() => {
        const imageUrls = Object.fromEntries(
          (items.data ?? []).filter((row) => row.image_url).map((row) => [row.slug, row.image_url as string]),
        );
        return Object.keys(imageUrls).length > 0 ? { imageUrls } : {};
      })(),
    },
    updatedAt: brandRow.updated_at ?? null,
  };
}
