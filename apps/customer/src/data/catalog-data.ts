/**
 * The customer binary's generated tenant menu, kept asset-free for node:test.
 * `pnpm onboard --tenant <slug> --apply` writes tenant/menu.json from the
 * tenant-owned CSV, category metadata, and modifiers file.
 */
import type { OptionGroup } from '@platform/domain';

import menuJson from '@/tenant/menu.json';

export type MenuCategoryId = string;
export type CatalogSize = { slug: string; ounces?: number; priceCents: number };
export type CatalogItemData = {
  id: string;
  name: string;
  description: string;
  category: MenuCategoryId;
  sizes: readonly CatalogSize[];
  optionGroups: readonly OptionGroup[];
  soldOutToday?: boolean;
};

type BundledMenu = {
  categories: { id: string; title: string; tagline: string }[];
  items: CatalogItemData[];
};

const bundled = menuJson as unknown as BundledMenu;

export const MENU_CATEGORY_META = bundled.categories;
export const CATALOG_ITEMS: readonly CatalogItemData[] = bundled.items;

export type MenuAddOn = {
  slug: string;
  name: string;
  priceCents: number;
  durationMin: 0;
  description: string;
};

function tenantAddOns(items: readonly CatalogItemData[]): MenuAddOn[] {
  const seen = new Set<string>();
  return items.flatMap((item) => item.optionGroups.flatMap((group) => (
    group.choices.flatMap((choice) => {
      if (choice.priceDeltaCents <= 0 || seen.has(choice.id)) return [];
      seen.add(choice.id);
      return [{
        slug: choice.id,
        name: choice.name,
        priceCents: choice.priceDeltaCents,
        durationMin: 0 as const,
        description: `Available on eligible ${item.name.toLowerCase()} orders.`,
      }];
    })
  )));
}

/** Paid customizations authored by this tenant, deduplicated by choice id. */
export const MENU_ADD_ONS: readonly MenuAddOn[] = tenantAddOns(CATALOG_ITEMS);
