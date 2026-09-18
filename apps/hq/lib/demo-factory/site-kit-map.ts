/**
 * A crawled website, and a model's reading of it when there is one, as the
 * brand kit a demo is built from.
 *
 * The crawl alone already gives a demo its colors, its logo and the address
 * the business publishes for enquiries; the model adds the menu and a
 * sharper palette. So a deployment with no OpenAI key still builds branded
 * demos -- with the labelled sample menu -- and still has someone to write to.
 */
import type { SiteCrawl } from '../site-crawl/crawl-site';
import type { SiteExtraction } from '../site-crawl/extraction-parse';
import type { DemoBrandKit } from './kit';

const HEX = /^#[0-9a-f]{6}$/;
const MAX_COLORS = 4;
const TAGLINE_MAX = 160;

function palette(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => HEX.test(value)))]
    .slice(0, MAX_COLORS);
}

/** The model's palette when it gave one, else the site's own non-neutral colors in the crawl's ranking. */
export function kitColors(crawl: Pick<SiteCrawl, 'colors'>, extraction: Pick<SiteExtraction, 'colors'> | null): string[] {
  const read = palette(extraction?.colors ?? []);
  return read.length > 0 ? read : palette(crawl.colors.filter((color) => !color.neutral).map((color) => color.hex));
}

/**
 * The business's own description when it is short enough to be a tagline,
 * else the first sentence of the model's summary: the business's words
 * before ours.
 */
export function kitTagline(description: string | null, summary: string | null): string | null {
  const own = description?.replace(/\s+/g, ' ').trim();
  if (own && own.length <= TAGLINE_MAX) return own;
  const text = summary?.replace(/\s+/g, ' ').trim() ?? '';
  const first = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return first && first.length <= TAGLINE_MAX ? first : null;
}

/** The logo worth downloading: the model's choice among the crawl's candidates, else the crawl's best. */
export function kitLogoUrl(crawl: Pick<SiteCrawl, 'logos'>, extraction: Pick<SiteExtraction, 'logoUrl'> | null): string | null {
  return extraction?.logoUrl ?? crawl.logos[0]?.url ?? null;
}

/** `logo` is the stored media name, or null when no logo could be kept. */
export function demoKitFrom(crawl: SiteCrawl, extraction: SiteExtraction | null, logo: string | null): DemoBrandKit {
  return {
    colors: kitColors(crawl, extraction),
    tagline: kitTagline(crawl.description, extraction?.summary ?? null),
    email: crawl.contactEmails[0] ?? null,
    logo,
    menu: (extraction?.items ?? []).map(({ name, description, priceCents, category }) => ({
      name, description, priceCents, category, image: null,
    })),
  };
}
