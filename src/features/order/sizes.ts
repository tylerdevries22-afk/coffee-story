/**
 * Reading a size out of a catalog slug.
 *
 * `data/catalog.ts` carries sizes in the `durations` slot it inherited from
 * the appointment app: `minutes` holds ounces for a drink, and the slug holds
 * the suffix for everything else (`-single`, `-double`, `-trio`, `-slice`).
 * This module is the one place that translation happens, so the menu, the bag
 * and the receipt cannot describe the same line differently.
 *
 * Pure — no asset imports — so `node:test` reaches it.
 */
import { formatMoney } from '@/features/money';

export type CatalogSize = { slug: string; minutes: number; price: number };

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

/** Catalog prices are whole dollars; everything downstream works in cents. */
export function sizePriceCents(size: CatalogSize): number {
  return Math.max(0, Math.round(size.price * 100));
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
