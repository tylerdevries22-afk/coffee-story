/**
 * The catalog, arranged the way the menu screen renders it.
 *
 * Lives beside the screen rather than in `features/order` because it imports
 * `data/catalog.ts`, which imports the item photography — the feature modules
 * stay free of asset imports so `node:test` can reach them.
 */
import { MENU_CATEGORY_META, SERVICES, type MenuCategoryId, type Service } from '@/data/catalog';
import type { CatalogSize } from '@/features/order/sizes';

export type MenuSection = {
  id: MenuCategoryId;
  title: string;
  tagline: string;
  items: readonly Service[];
};

/** Categories in menu order, with the empty ones dropped. */
export function menuSections(): MenuSection[] {
  return MENU_CATEGORY_META.map((category) => ({
    id: category.id,
    title: category.title,
    tagline: category.tagline,
    items: SERVICES.filter((service) => service.category === category.id),
  })).filter((section) => section.items.length > 0);
}

export function findMenuItem(itemId: string): Service | undefined {
  return SERVICES.find((service) => service.id === itemId);
}

/** `Service.durations` under the name the rest of the order flow uses. */
export function sizesFor(service: Service): readonly CatalogSize[] {
  return service.durations;
}
