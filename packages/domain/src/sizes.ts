/**
 * Reading a size out of a catalog slug.
 *
 * A drink's size lives in `ounces`; everything else carries it in the slug
 * suffix (`-single`, `-double`, `-trio`, `-slice`). This module is the one
 * place that translation happens, so the menu, the bag and the receipt cannot
 * describe the same line differently.
 *
 * Pure — no asset imports — so `node:test` reaches it.
 */
import { formatMoney } from './money';

/**
 * One orderable size of a menu item.
 *
 * The type lives here rather than beside the catalog data: the catalog is
 * per-tenant content, but what a size *is* -- a slug, an optional volume, and
 * a price in integer cents -- is the same on every surface that prices one.
 */
export type CatalogSize = { slug: string; ounces?: number; priceCents: number };

/** "16 oz", "Single", "Each". */
export function sizeLabelFor(slug: string): string {
  const ounces = /-(\d+)$/.exec(slug);
  if (ounces) return `${ounces[1]} oz`;
  if (slug.endsWith('-single')) return 'Single';
  if (slug.endsWith('-double')) return 'Double';
  if (slug.endsWith('-trio')) return 'Trio';
  if (slug.endsWith('-slice')) return 'Slice';
  return 'Each';
}

/** Kept as the single read point now that the catalog itself carries cents. */
export function sizePriceCents(size: CatalogSize): number {
  return Math.max(0, Math.round(size.priceCents));
}

/**
 * What a menu row shows on the right.
 *
 * One size prints its price; several print the cheapest as a "from", which is
 * the only honest summary when a tap opens a size picker.
 */
export function menuPriceLabel(sizes: readonly CatalogSize[]): string {
  if (sizes.length === 0) return '';
  const cheapest = Math.min(...sizes.map(sizePriceCents));
  return sizes.length === 1 ? formatMoney(cheapest) : `from ${formatMoney(cheapest)}`;
}

/** The size a detail screen opens on: the middle one, or the only one. */
export function defaultSizeSlug(sizes: readonly CatalogSize[]): string {
  if (sizes.length === 0) return '';
  return sizes[Math.floor((sizes.length - 1) / 2)].slug;
}
