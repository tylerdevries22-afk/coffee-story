/**
 * Where a kiosk photograph comes from, in order of preference.
 *
 * `docs/FIVE-SURFACES.md` records the decision this implements: the kiosk does
 * not carry a third copy of the ~60 bundled menu assets. `menu_items.image_url`
 * exists so imagery arrives with the rows, and a franchise onboarded next month
 * should be able to change a photograph without a rebuild.
 *
 * Three tiers, and the last one always succeeds -- a circle on the first screen
 * is a target a guest is about to press, so it can be unphotographed but never
 * empty.
 */

export type BundledArt = Record<string, number>;

export type ResolvedImage =
  /** A photograph from the row. Cached to disk by the renderer. */
  | { kind: 'remote'; uri: string }
  /** One of the handful shipped in the binary, for the first screen. */
  | { kind: 'bundled'; source: number }
  /** Token-drawn from the brand's monogram. Never fails, never fetches. */
  | { kind: 'monogram'; initials: string };

export type ImageRequest = {
  imageUrl?: string | null;
  /** A key into the bundled set, from `brand_config.kiosk`'s `imageSlug`. */
  imageSlug?: string | null;
  /** `brand_config.business.monogram`, e.g. "CS". */
  monogram?: string | null;
  /** The tile's own label, so a monogram can fall back to its first letter. */
  label?: string;
};

/** Only https. A kiosk must not be talked into a plaintext fetch by config. */
function usableUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function resolveImage(request: ImageRequest, bundled: BundledArt = {}): ResolvedImage {
  const remote = usableUrl(request.imageUrl);
  if (remote) return { kind: 'remote', uri: remote };

  const slug = request.imageSlug;
  if (slug) {
    const source = bundled[slug];
    if (typeof source === 'number') return { kind: 'bundled', source };
  }

  return { kind: 'monogram', initials: initialsFor(request) };
}

/**
 * The monogram is the brand's, not the item's: a tile with no photograph should
 * read as this shop's tile, not as a missing file. It falls back to the label's
 * own first letter only when the brand has no monogram at all.
 */
export function initialsFor(request: ImageRequest): string {
  const monogram = request.monogram?.trim();
  if (monogram) return monogram.slice(0, 3).toUpperCase();
  const label = request.label?.trim();
  if (label) return label.slice(0, 1).toUpperCase();
  return '';
}
