/**
 * A demo pack, and the landing page's reading of it.
 *
 * The pack is what the demo factory stores for one prospect (version 1):
 * `brand`, `menu` and `modules` in the same shapes as a tenant folder's
 * brand.json, menu.json and modules.json, so the guest apps can render a demo
 * the way they render a tenant; `media`, which names objects in the private
 * demo-media bucket rather than holding URLs; and `listing`, the few facts
 * taken straight from the business's Google listing.
 *
 * Everything in it came from a scraped website or a third-party listing, so
 * it is read as hostile: this parser is total, bounds every string and list,
 * keeps only https links, and admits a media name only in a shape that cannot
 * climb out of the demo's own folder. React escapes the text it renders; this
 * is what keeps a `javascript:` link or a 5 MB "name" off the page anyway.
 */
export type DemoMenuItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: number | null;
  readonly image: string | null;
};

export type DemoMenuSection = { readonly title: string; readonly items: readonly DemoMenuItem[] };

export type DemoLanding = {
  readonly name: string;
  readonly tagline: string | null;
  /** brand.json-shaped, for `hqTheme`; the page's colours come from here. */
  readonly brandConfig: Record<string, unknown>;
  readonly logo: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly mapsUri: string | null;
  readonly reviewsUri: string | null;
  readonly hours: readonly string[];
  readonly menu: readonly DemoMenuSection[];
  /** The factory's starter menu stood in for one it could not read, and the page must say so. */
  readonly menuSample: boolean;
};

/** An object name inside one demo's media folder: no slashes, no dot-dot. */
export const DEMO_MEDIA_NAME = /^[a-z0-9][a-z0-9_-]{0,80}\.(?:webp|png|jpe?g)$/;

const LIMIT = { sections: 6, items: 8, name: 120, text: 280, hours: 7 } as const;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {};
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, max: number = LIMIT.name): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function https(value: unknown): string | null {
  const candidate = str(value, 2048);
  if (candidate === null) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function mediaName(value: unknown): string | null {
  return typeof value === 'string' && DEMO_MEDIA_NAME.test(value) ? value : null;
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function item(raw: unknown, images: Json): (DemoMenuItem & { readonly category: string | null }) | null {
  const source = record(raw);
  const id = str(source.id, 80);
  const name = str(source.name);
  if (id === null || name === null) return null;
  const firstSize = record(list(source.sizes)[0]);
  return {
    id, name,
    description: str(source.description, LIMIT.text),
    priceCents: cents(firstSize.priceCents),
    image: mediaName(images[id]),
    category: str(source.category, 80),
  };
}

function menuSections(menu: Json, images: Json): readonly DemoMenuSection[] {
  const items = list(menu.items).map((entry) => item(entry, images))
    .filter((entry) => entry !== null);
  const declared = list(menu.categories).map(record)
    .map((category) => ({ id: str(category.id, 80), title: str(category.title) }))
    .filter((category) => category.id !== null && category.title !== null);
  const sections = declared.map((category) => ({
    title: category.title ?? '',
    items: items.filter((entry) => entry.category === category.id),
  }));
  // Items naming a category the menu never declared still belong on the page.
  const known = new Set(declared.map((category) => category.id));
  const loose = items.filter((entry) => entry.category === null || !known.has(entry.category));
  return [...sections, { title: 'More', items: loose }]
    .filter((section) => section.items.length > 0)
    .slice(0, LIMIT.sections)
    .map((section) => ({
      title: section.title,
      items: section.items.slice(0, LIMIT.items)
        .map(({ id, name, description, priceCents, image }) => ({ id, name, description, priceCents, image })),
    }));
}

function addressLine(brand: Json): string | null {
  const address = record(record(list(brand.locations)[0]).address);
  const region = [str(address.region, 40), str(address.postal, 20)].filter(Boolean).join(' ');
  const parts = [str(address.street), str(address.city, 80), region || null].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function demoLanding(pack: unknown, fallbackName: string): DemoLanding {
  const source = record(pack);
  const brand = record(source.brand);
  const business = record(brand.business);
  const listing = record(source.listing);
  const media = record(source.media);
  return {
    name: str(record(brand.identity).name) ?? str(fallbackName) ?? 'This business',
    tagline: str(business.tagline, LIMIT.text),
    brandConfig: brand,
    logo: mediaName(media.logo),
    address: addressLine(brand),
    phone: str(business.phone, 40),
    website: https(business.website),
    mapsUri: https(listing.mapsUri),
    reviewsUri: https(listing.reviewsUri),
    hours: list(listing.weekdayDescriptions).map((line) => str(line, 80))
      .filter((line) => line !== null).slice(0, LIMIT.hours),
    menu: menuSections(record(source.menu), record(media.items)),
    menuSample: source.menuSource === 'sample',
  };
}
