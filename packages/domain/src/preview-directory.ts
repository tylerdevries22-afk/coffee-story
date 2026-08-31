export type PreviewSurface = 'customer' | 'kiosk' | 'display';

export type PreviewTarget = {
  slug: string;
  label: string;
  url: string;
  current: boolean;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SURFACES: readonly PreviewSurface[] = ['customer', 'kiosk', 'display'];

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Parse the public, preview-only directory. Invalid entries fail closed. */
export function previewTargets(
  raw: string | undefined,
  surface: PreviewSurface,
  currentSlug: string,
): PreviewTarget[] {
  if (!raw || raw.length > 20_000 || !SURFACES.includes(surface)) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value) || value.length > 12) return [];
  const seen = new Set<string>();
  const result: PreviewTarget[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as { slug?: unknown; label?: unknown; urls?: unknown };
    if (typeof candidate.slug !== 'string' || !SLUG.test(candidate.slug) || seen.has(candidate.slug)) continue;
    if (typeof candidate.label !== 'string' || candidate.label.trim().length < 2 || candidate.label.length > 80) continue;
    const urls = candidate.urls;
    if (!urls || typeof urls !== 'object' || Array.isArray(urls)) continue;
    const url = safeUrl((urls as Record<string, unknown>)[surface]);
    if (!url) continue;
    seen.add(candidate.slug);
    result.push({ slug: candidate.slug, label: candidate.label.trim(), url, current: candidate.slug === currentSlug });
  }
  return result;
}
