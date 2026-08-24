/**
 * Where a product cut-out comes from, for one tenant.
 *
 * The menu-photograph path resolves at build time and only at build time: 61
 * static imports and a slug map in `apps/customer/src/data/catalog.ts`. That
 * works for one brand and gets worse with every additional one, because a
 * second franchise's artwork ends up compiled into the first franchise's
 * binary — they share the file.
 *
 * This resolver is the same idea with the tenant taken out of the code. It
 * returns a *reference*, never a Metro module id, which is what keeps it
 * framework-free and reachable from `node:test`; the view layer does the last
 * mile. That indirection is also what lets the remote arm arrive later without
 * touching either the resolver or the component: the union already has a place
 * for it, `menu_items.image_url` already exists, and the `menu-images` bucket
 * already carries RLS scoped to a `{brand_id}/` prefix. Until a writer exists,
 * `remote` is simply empty.
 *
 * The one rule that matters for a franchise: **a missing cut-out is null, not a
 * throw.** `withImage()` on the photograph path throws at module load for an
 * item with no photo, which is right there — a menu row with no picture is a
 * build mistake. It is wrong here. A tenant that has shot four of its ten teas
 * should get a shelf of four, not a white screen.
 */

/** A cut-out the app can draw, once the view layer resolves it to a source. */
export type ProductMediaRef =
  | { kind: 'bundled'; slug: string }
  | { kind: 'remote'; slug: string; url: string };

export type ProductMediaCatalog = {
  /** Slugs this build ships a cut-out for. */
  readonly bundled: ReadonlySet<string>;
  /** slug -> absolute URL, from `menu_items.image_url`. Empty until that has a writer. */
  readonly remote: ReadonlyMap<string, string>;
};

export const EMPTY_PRODUCT_MEDIA: ProductMediaCatalog = {
  bundled: new Set<string>(),
  remote: new Map<string, string>(),
};

/**
 * A remote URL has to be absolute http(s) to be worth preferring.
 *
 * A relative path, a `file:` URL or a storage key that never got expanded all
 * render as nothing, and falling back to the bundled asset is strictly better
 * than an empty frame — the same field-by-field degradation `resolveTokens`
 * applies to a malformed tenant value rather than unbranding the whole app.
 */
function usableUrl(url: string | undefined): url is string {
  if (!url) return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

/**
 * Remote wins when it is present and well-formed; the bundled asset is the
 * floor. Null means this item has no cut-out at all, and the caller must not
 * reserve space for one — an empty frame reads as a broken image, where a row
 * that simply is not there reads as a shorter shelf.
 */
export function resolveProductMedia(
  slug: string,
  catalog: ProductMediaCatalog,
): ProductMediaRef | null {
  const url = catalog.remote.get(slug);
  if (usableUrl(url)) return { kind: 'remote', slug, url };
  if (catalog.bundled.has(slug)) return { kind: 'bundled', slug };
  return null;
}

/**
 * The subset of a lineup that has a cut-out, in the order given, capped.
 *
 * `remaining` is what the see-all link counts, so the label stays true when a
 * tenant adds a render or a menu changes underneath it. Items with no cut-out
 * are not shown and not counted as remaining — they are not part of this shelf
 * at all.
 */
export function cutoutFeatureLineup(
  ids: readonly string[],
  catalog: ProductMediaCatalog,
  limit: number,
): { shown: string[]; remaining: number } {
  const withMedia = ids.filter((id) => resolveProductMedia(id, catalog) !== null);
  const capped = Math.max(0, Math.trunc(limit));
  return {
    shown: withMedia.slice(0, capped),
    remaining: Math.max(0, withMedia.length - capped),
  };
}
