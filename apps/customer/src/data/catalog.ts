/** The generated tenant menu with its Metro-safe static image map attached. */
import { TENANT_MENU_MEDIA } from '@/tenant/menu-media';

import { CATALOG_ITEMS, type CatalogItemData, type MenuCategoryId } from './catalog-data';

export { MENU_ADD_ONS, MENU_CATEGORY_META } from './catalog-data';
export type { MenuCategoryId } from './catalog-data';

export type MenuItem = CatalogItemData & { image: number; category: MenuCategoryId };

function withImage(item: CatalogItemData): MenuItem {
  const image = TENANT_MENU_MEDIA[item.id];
  if (image === undefined) throw new Error(`Menu item "${item.id}" has no bundled tenant image.`);
  return { ...item, image };
}

export const MENU_ITEMS: readonly MenuItem[] = CATALOG_ITEMS.map(withImage);

export const AVAILABLE_DATES = ['Today', 'Tomorrow', 'Sat 1', 'Sun 2', 'Mon 3'] as const;
export const AVAILABLE_TIMES = ['8:30 AM', '10:00 AM', '12:30 PM', '3:00 PM', '6:30 PM'] as const;

export const REDEMPTIONS = [
  { id: 'r1', name: '$5 drink credit', points: 500 },
  { id: 'r2', name: 'Free item', points: 800 },
  { id: 'r3', name: '$15 order credit', points: 1500 },
  { id: 'r4', name: 'Featured item', points: 2000 },
] as const;
