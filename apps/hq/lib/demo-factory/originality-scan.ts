/**
 * Every visible-copy string in an assembled demo pack, labelled by where it
 * lives, for originality.ts to check.
 *
 * `brand` is walked generically: it is the tenant manifest merged with the
 * website's own words, arbitrarily deep, and brand.json's own `copy` block
 * documents itself as "every user-facing brand string" -- so a name-shaped
 * field added there later is covered without editing this file. `menu` and
 * `listing` are read by their known shape instead, because that is where the
 * words a guest actually reads live: category and item copy, and the hours
 * Google published. Media keys and link targets are identifiers a guest
 * never reads as text, so they are left out rather than flagged as false
 * leads that send someone looking for a name in a filename.
 */

export type PackTextField = { readonly field: string; readonly text: string };

/** The slice of an assembled `DemoPack` this module reads; the real type has more, which is fine here. */
export type OriginalityPack = {
  readonly brand: unknown;
  readonly menu: {
    readonly categories: readonly { readonly id: string; readonly title: string; readonly tagline: string }[];
    readonly items: readonly { readonly id: string; readonly name: string; readonly description: string }[];
  };
  readonly listing: { readonly weekdayDescriptions: readonly string[] };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A link target, never something a guest reads as copy. */
const URL_LIKE = /^https?:\/\//iu;

function walk(value: unknown, field: string, out: PackTextField[]): void {
  if (typeof value === 'string') {
    if (value.trim() !== '' && !URL_LIKE.test(value)) out.push({ field, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${field}[${index}]`, out));
  } else if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) walk(nested, field ? `${field}.${key}` : key, out);
  }
}

/**
 * `businessName` is passed in rather than read off the pack because the
 * database column it becomes (`platform_demo_sites.business_name`) is
 * assembled by the runner from the listing, not carried on `DemoPack`
 * itself -- so a caller that skipped it would silently leave the page's own
 * headline unchecked.
 */
export function packTextFields(businessName: string, pack: OriginalityPack): readonly PackTextField[] {
  const fields: PackTextField[] = [];
  walk(businessName, 'businessName', fields);
  walk(pack.brand, 'brand', fields);
  for (const category of pack.menu.categories) {
    walk(category.title, `menu.category.${category.id}.title`, fields);
    walk(category.tagline, `menu.category.${category.id}.tagline`, fields);
  }
  for (const item of pack.menu.items) {
    walk(item.name, `menu.item.${item.id}.name`, fields);
    walk(item.description, `menu.item.${item.id}.description`, fields);
  }
  pack.listing.weekdayDescriptions.forEach((line, index) => {
    walk(line, `listing.weekdayDescriptions[${index}]`, fields);
  });
  return fields;
}
