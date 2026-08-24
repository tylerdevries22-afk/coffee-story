/** The tenant menu bundled for offline kiosk previews. */
import menuJson from '@/tenant/menu.json';

export type MenuCategoryId = string;

export type CatalogSize = {
  slug: string;
  ounces?: number;
  priceCents: number;
};

export type CatalogItemData = {
  id: string;
  name: string;
  description: string;
  category: MenuCategoryId;
  sizes: readonly CatalogSize[];
  soldOutToday?: boolean;
  packSize?: number;
  choiceSource?: 'lineup' | 'static';
  singleItemId?: string;
};

type BundledMenu = {
  categories: { id: string; title: string; tagline: string }[];
  items: CatalogItemData[];
};

const bundled = menuJson as unknown as BundledMenu;

export const MENU_CATEGORY_META = bundled.categories;
export const CATALOG_ITEMS: readonly CatalogItemData[] = bundled.items;
