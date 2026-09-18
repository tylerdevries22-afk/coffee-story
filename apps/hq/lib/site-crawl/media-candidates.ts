import type { PageFacts } from './html-facts';

/**
 * Pictures worth downloading: logo candidates and item or hero photographs.
 *
 * Nothing is fetched here -- this only ranks addresses the pages published.
 * Logos are ranked by how deliberately the site labelled them: structured
 * data first, then an image in the header that calls itself a logo, then the
 * touch icon (a clean square raster by design), then any logo-named image,
 * then the social share image, then a PNG favicon. SVG and ICO are skipped
 * because the downloader refuses them (see public-fetch/kinds.ts), so a
 * candidate that could never be fetched is never offered to the extractor.
 */
export type LogoSource = 'json-ld' | 'header-image' | 'touch-icon' | 'logo-image' | 'og-image' | 'icon';
export type LogoCandidate = { readonly url: string; readonly source: LogoSource };
export type ImageCandidate = { readonly url: string; readonly alt: string; readonly page: string };

const MAX_LOGOS = 8;
const MAX_IMAGES = 24;
const MIN_EDGE = 150;
const UNFETCHABLE = /\.(?:svg|svgz|ico|avif|bmp|tiff?|heic)$/i;
/** Matched from a word start, so a custard tart is not a "star" and a favicon still is an icon. */
const NOT_A_PHOTO = /(?:^|[^a-z])(?:logo|favicon|icon|avatar|badge|sprite|placeholder|spinner|loader|pixel|flag|payment|star|rating)/;

/** `href` resolved against the page, as https, or null when it cannot be downloaded. */
export function mediaUrl(href: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(href.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || UNFETCHABLE.test(url.pathname)) return null;
  url.hash = '';
  return url.href;
}

function iconEdge(sizes: string | null): number {
  const match = /(\d+)x\d+/i.exec(sizes ?? '');
  return match ? Number(match[1]) : 0;
}

export function logoCandidates(page: PageFacts, pageUrl: URL, structuredLogos: readonly string[]): LogoCandidate[] {
  const found: LogoCandidate[] = [];
  const add = (href: string | undefined | null, source: LogoSource): void => {
    const url = href ? mediaUrl(href, pageUrl) : null;
    if (url !== null && found.length < MAX_LOGOS && !found.some((entry) => entry.url === url)) found.push({ url, source });
  };
  for (const logo of structuredLogos) add(logo, 'json-ld');
  for (const image of page.images) if (image.inChrome && image.hint.includes('logo')) add(image.src, 'header-image');
  const touchIcons = page.icons
    .filter((icon) => icon.rel.includes('apple-touch-icon'))
    .sort((a, b) => iconEdge(b.sizes) - iconEdge(a.sizes));
  for (const icon of touchIcons) add(icon.href, 'touch-icon');
  for (const image of page.images) if (image.hint.includes('logo')) add(image.src, 'logo-image');
  add(page.meta['og:image'], 'og-image');
  const pngIcons = page.icons
    .filter((icon) => !icon.rel.includes('apple-touch-icon') && /\.png(?:$|\?)/i.test(icon.href))
    .sort((a, b) => iconEdge(b.sizes) - iconEdge(a.sizes));
  for (const icon of pngIcons) add(icon.href, 'icon');
  return found;
}

/**
 * Candidate item and hero photographs from the given pages, the share image
 * first. Chrome, logo-ish and declared-tiny images are skipped: a demo needs
 * pictures of what the business sells, not its icons.
 */
export function imageCandidates(pages: readonly { readonly url: URL; readonly facts: PageFacts }[]): ImageCandidate[] {
  const found: ImageCandidate[] = [];
  const add = (href: string | undefined, alt: string, page: URL): void => {
    const url = href ? mediaUrl(href, page) : null;
    if (url !== null && found.length < MAX_IMAGES && !found.some((entry) => entry.url === url)) {
      found.push({ url, alt, page: page.href });
    }
  };
  for (const { url, facts } of pages) add(facts.meta['og:image'], facts.meta['og:image:alt'] ?? '', url);
  for (const { url, facts } of pages) {
    for (const image of facts.images) {
      if (image.inChrome || NOT_A_PHOTO.test(image.hint)) continue;
      if ((image.width !== null && image.width < MIN_EDGE) || (image.height !== null && image.height < MIN_EDGE)) continue;
      add(image.src, image.alt, url);
    }
  }
  return found;
}
