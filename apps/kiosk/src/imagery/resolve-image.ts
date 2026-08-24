/**
 * Where a kiosk photograph comes from, in order of preference.
 *
 * Onboarding gives the customer and kiosk the same generated menu-media map.
 * Known tenant slugs therefore stay pixel-identical and work offline; a remote
 * URL is reserved for a live item that was added after this binary shipped.
 *
 * Three tiers, and the last one always succeeds -- a circle on the first screen
 * is a target a guest is about to press, so it can be unphotographed but never
 * empty.
 */

/** Metro uses numeric asset ids on native and source objects on web. */
export type BundledImageSource = number | string | {
  readonly uri?: string;
  readonly width?: number | null;
  readonly height?: number | null;
};

export type BundledArt = Readonly<Record<string, BundledImageSource>>;

export type ResolvedImage =
  /** A photograph from the row. Cached to disk by the renderer. */
  | { kind: 'remote'; uri: string }
  /** Tenant artwork shipped in the binary. */
  | { kind: 'bundled'; source: BundledImageSource }
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

export function resolveImage(
  request: ImageRequest,
  bundled: BundledArt = {},
  failedRemoteUri: string | null = null,
): ResolvedImage {
  const slug = request.imageSlug;
  if (slug) {
    const source = bundled[slug];
    // Static imports are numbers on iOS/Android but `{ uri, width, height }`
    // objects in Expo's web bundle. Treat the generated map as the trust
    // boundary instead of guessing which Metro representation is active.
    if (source !== undefined) return { kind: 'bundled', source };
  }

  const remote = usableUrl(request.imageUrl);
  if (remote && remote !== failedRemoteUri) return { kind: 'remote', uri: remote };

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
