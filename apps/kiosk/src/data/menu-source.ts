/**
 * The bundled menu, for a kiosk with no backend configured.
 *
 * This used to be THE menu: `catalog-data.ts` compiled into the binary, which
 * meant a second tenant could not change a price, add an item or 86 something
 * without a rebuild and a store release. That was the last franchise blocker
 * on this surface, and `menu-store.tsx` now reads live rows instead.
 *
 * What is left here is a demo fixture — it drives the web export, the capture
 * recipes and a walkthrough with nothing running. It is deliberately NOT a
 * fallback for a configured kiosk that fails to read: this is one tenant's
 * menu, and serving it to a different brand's tablet would price their drinks
 * wrong under their own logo. A configured kiosk that cannot read says so.
 */
import { kioskMenuFromRows, type KioskMenu, type KioskMenuItem } from '@platform/domain';

import { MENU_CATEGORY_META, MENU_ITEMS } from '@/data/catalog';

/** The bundled catalog in the shape live rows map to. */
export function demoMenu(): KioskMenu {
  const titleById = new Map(MENU_CATEGORY_META.map((meta) => [meta.id, meta.title]));
  const items: KioskMenuItem[] = MENU_ITEMS.flatMap((item) => {
    const categoryId = titleById.get(item.category);
    if (categoryId === undefined) return [];
    return [{
      id: item.id,
      name: item.name,
      description: item.description,
      categoryId,
      sizes: item.sizes,
      soldOutToday: item.soldOutToday === true,
      // The bundled catalog predates rotation; everything in it is always on.
      rotation: 'permanent' as const,
      ...(typeof item.packSize === 'number' ? { packSize: item.packSize } : {}),
      ...(item.choiceSource ? { choiceSource: item.choiceSource } : {}),
      ...(item.singleItemId ? { singleItemId: item.singleItemId } : {}),
    }];
  });
  return {
    categories: MENU_CATEGORY_META.map((meta) => ({
      id: meta.title, title: meta.title, tagline: meta.tagline,
    })),
    items,
    drops: [],
  };
}

/** Re-exported so a caller needs one import to go from rows to a menu. */
export { kioskMenuFromRows };
