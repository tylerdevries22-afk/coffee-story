/**
 * What a business's own website adds to its demo: colors, a tagline, a
 * public contact address, a logo and its menu.
 *
 * The website crawl produces it; the pack builder takes it as this shape and
 * checks it again here, because a website is the least trusted thing the
 * factory reads. Text is bounded and stripped of markup and control
 * characters, prices must be whole non-negative cents, media names must be
 * ones the demo media route would serve, and a color is only used where it
 * can be read.
 */
import { slugify } from '@platform/domain';
import type { BundledTenantMenu } from '@platform/schema';

import { DEMO_MEDIA_NAME } from '../demo-pack';

export type DemoKitItem = {
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: number | null;
  readonly category: string | null;
  /** The uploaded media name of this item's photo. */
  readonly image: string | null;
};

export type DemoBrandKit = {
  /** Brand colors, most prominent first, as `#rrggbb`. */
  readonly colors: readonly string[];
  readonly tagline: string | null;
  /** A contact address the business publishes on its own site. */
  readonly email: string | null;
  readonly logo: string | null;
  readonly menu: readonly DemoKitItem[];
};

export type KitMenu = { readonly menu: BundledTenantMenu; readonly images: Readonly<Record<string, string>> };

const ITEMS_MAX = 60;
const CATEGORIES_MAX = 12;
const NAME_MAX = 80;
const TEXT_MAX = 280;
const HEX = /^#[0-9a-f]{6}$/;

export function kitText(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(/[\p{Cc}<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function unique(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** The kit's menu in the guest apps' own menu shape, or null when it has none worth showing. */
export function kitMenu(kit: DemoBrandKit): KitMenu | null {
  const categories = new Map<string, BundledTenantMenu['categories'][number]>();
  const categoryIds = new Set<string>();
  const itemIds = new Set<string>();
  const items: BundledTenantMenu['items'] = [];
  const images: Record<string, string> = {};
  for (const raw of kit.menu) {
    if (items.length >= ITEMS_MAX) break;
    const name = kitText(raw.name, NAME_MAX);
    const base = slugify(name, 60);
    if (base.length < 2) continue;
    const title = kitText(raw.category, NAME_MAX) || 'Menu';
    let category = categories.get(title);
    if (!category) {
      if (categories.size >= CATEGORIES_MAX) continue;
      category = { id: unique(slugify(title, 40) || 'menu', categoryIds), title, tagline: '' };
      categories.set(title, category);
    }
    const id = unique(base, itemIds);
    const price = raw.priceCents;
    items.push({
      id,
      name,
      description: kitText(raw.description, TEXT_MAX),
      category: category.id,
      // No price is shown as no price, never as free.
      sizes: typeof price === 'number' && Number.isSafeInteger(price) && price >= 0 ? [{ slug: id, priceCents: price }] : [],
      optionGroups: [],
    });
    if (raw.image && DEMO_MEDIA_NAME.test(raw.image)) images[id] = raw.image;
  }
  return items.length > 0 ? { menu: { version: 1, categories: [...categories.values()], items }, images } : null;
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` color. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => channel(Number.parseInt(hex.slice(start, start + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The kit's colors as brand tokens, only where they read: `primary` carries
 * white text, so it needs 4.5:1 against white; `accent` sits on the page
 * surface, so it needs 3:1 against it. A brand whose colors are all pale
 * keeps the neutral tokens rather than an unreadable demo.
 */
export function kitTokens(kit: DemoBrandKit, surface: string): { primary?: string; accent?: string } {
  const colors = kit.colors.map((color) => color.trim().toLowerCase()).filter((color) => HEX.test(color));
  const surfaceLuminance = HEX.test(surface.toLowerCase()) ? luminance(surface.toLowerCase()) : 1;
  const primary = colors.find((color) => contrast(luminance(color), 1) >= 4.5);
  const accent = colors.find((color) => color !== primary && contrast(luminance(color), surfaceLuminance) >= 3);
  return { ...(primary ? { primary } : {}), ...(accent ? { accent } : {}) };
}
