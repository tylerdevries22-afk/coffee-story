/**
 * A round-trip view of the generated tenant menu. The source direction is
 * tenant files -> onboarding -> this bundle; these helpers let the drift test
 * prove that codegen preserved the source without making the app authoritative.
 *
 * Slug translation: a catalog size slug is `<item>-<suffix>` ("latte-16",
 * "mochi-donut-trio") or the bare item id for single-serve items. The
 * database stores the suffix alone; the bare-id case becomes an item with no
 * sizes. The order flow applies the same rule in reverse when it builds a
 * PlaceOrderRequest.
 */
import type { OptionGroup } from '@platform/domain';
import { sizePriceCents } from '@platform/domain';

import { CATALOG_ITEMS, MENU_CATEGORY_META } from './catalog-data';

export function sizeSuffix(itemId: string, catalogSizeSlug: string): string | null {
  if (catalogSizeSlug === itemId) return null;
  return catalogSizeSlug.startsWith(`${itemId}-`)
    ? catalogSizeSlug.slice(itemId.length + 1)
    : catalogSizeSlug;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function menuCsv(): string {
  const titles = new Map(MENU_CATEGORY_META.map((category) => [category.id, category.title]));
  const lines = ['slug,name,category,description,base_price_cents,sizes'];
  for (const item of CATALOG_ITEMS) {
    const suffixed = item.sizes
      .map((size) => ({ suffix: sizeSuffix(item.id, size.slug), cents: sizePriceCents(size) }));
    const single = suffixed.length === 1 && suffixed[0]!.suffix === null;
    const baseCents = Math.min(...suffixed.map((size) => size.cents));
    const sizes = single
      ? ''
      : suffixed.map((size) => `${size.suffix}:${size.cents}`).join('|');
    lines.push([
      csvField(item.id),
      csvField(item.name),
      csvField(titles.get(item.category) ?? item.category),
      csvField(item.description),
      String(baseCents),
      csvField(sizes),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Option groups per item slug, exactly the JSONB shape menu_items.modifiers holds. */
export function menuModifiers(): Record<string, OptionGroup[]> {
  const modifiers: Record<string, OptionGroup[]> = {};
  for (const item of CATALOG_ITEMS) {
    const groups = [...item.optionGroups];
    if (groups.length > 0) modifiers[item.id] = groups;
  }
  return modifiers;
}

export function menuModifiersJson(): string {
  return `${JSON.stringify(menuModifiers(), null, 2)}\n`;
}
