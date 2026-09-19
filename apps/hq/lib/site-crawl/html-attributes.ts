/**
 * Small readers for the attributes a crawl cares about.
 *
 * Kept apart from the parser so each rule -- which `srcset` candidate is the
 * real picture, what a `rel` says, whether a width attribute is a number --
 * is one tested function rather than a branch inside a callback.
 */
type Attributes = Readonly<Record<string, string | undefined>>;

/** The space-separated tokens of a `rel`, lowercased. */
export function relTokens(value: string | undefined): string[] {
  return (value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** A width or height attribute as whole pixels, or null for "auto", "100%" and junk. */
export function pixelDimension(value: string | undefined): number | null {
  if (value === undefined || !/^\s*\d{1,5}(?:px)?\s*$/i.test(value)) return null;
  return Number.parseInt(value, 10);
}

/**
 * The largest candidate in a `srcset`, by width descriptor or else density.
 *
 * Sites that lazy-load serve a placeholder in `src` and the real picture only
 * here, so the widest candidate is the one worth downloading.
 */
export function largestSrcsetCandidate(srcset: string | undefined): string | null {
  let best: { url: string; weight: number } | null = null;
  for (const entry of (srcset ?? '').split(/,\s+/)) {
    const [url, descriptor = '1x'] = entry.trim().split(/\s+/);
    if (!url) continue;
    const match = /^(\d+(?:\.\d+)?)([wx])$/.exec(descriptor);
    const weight = match ? Number(match[1]) * (match[2] === 'x' ? 1_000 : 1) : 0;
    if (best === null || weight > best.weight) best = { url, weight };
  }
  return best?.url ?? null;
}

/** The address a lazy-loading `<img>` will eventually show, before its placeholder. */
export function imageSource(attributes: Attributes): string | null {
  const fromSet = largestSrcsetCandidate(attributes.srcset ?? attributes['data-srcset']);
  const direct = attributes['data-src'] ?? attributes['data-lazy-src'] ?? attributes['data-original'] ?? attributes.src;
  const chosen = fromSet ?? direct ?? null;
  if (chosen === null || chosen.trim() === '' || chosen.startsWith('data:')) return null;
  return chosen.trim();
}

/** What an element says about itself: alt text, classes, id and file name, lowercased. */
export function elementHint(attributes: Attributes, source: string | null): string {
  const file = source?.split(/[?#]/)[0]?.split('/').pop() ?? '';
  return [attributes.alt, attributes.class, attributes.id, attributes.title, file]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
    .toLowerCase();
}
