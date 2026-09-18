import type { SiteCrawl } from './crawl-site';
import { groundingText } from './extraction-corpus';

/**
 * Checks the model's brand kit against what the site actually published.
 *
 * The schema already forces the shape and restricts the logo to the found
 * candidates. This checks what a schema cannot: an item survives only if its
 * name appears in the crawled text, and a price survives only if it is
 * printed near that name -- so a model that pads a menu with plausible
 * dishes, or fills in prices it guessed, loses them here. How much it had to
 * lose feeds the confidence that decides whether a stronger model re-reads
 * the site.
 */
export type SiteItem = {
  readonly name: string;
  readonly description: string | null;
  /** Integer cents, only when printed on the site next to the item. */
  readonly priceCents: number | null;
  readonly category: string | null;
};

export type SiteExtraction = {
  readonly summary: string;
  readonly colors: readonly string[];
  readonly logoUrl: string | null;
  readonly items: readonly SiteItem[];
  /** The model's own 0-1 confidence. */
  readonly confidence: number;
  /** Items the model returned that the site does not name. */
  readonly ungroundedItems: number;
};

export const MIN_CONFIDENCE = 0.6;
const MAX_ITEMS = 60;
const MAX_PRICE_CENTS = 10_000_000;
const PRICE_WINDOW = 160;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' || trimmed.length > maxLength ? null : trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The ways a price can be printed: 4.50, 4.5, and for whole dollars 4 and 4.00. */
function priceSpellings(cents: number): string[] {
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const spellings = [`${dollars}.${String(remainder).padStart(2, '0')}`];
  if (remainder % 10 === 0) spellings.push(`${dollars}.${remainder / 10}`);
  if (remainder === 0) spellings.push(`${dollars}`);
  return spellings;
}

/** Whether `cents` is printed within a short distance after any mention of `name`. */
export function priceNearName(corpus: string, name: string, cents: number): boolean {
  const pattern = new RegExp(`(?:^|[^0-9.])\\$?(?:${priceSpellings(cents).map(escapeRegExp).join('|')})(?![0-9]|\\.[0-9])`);
  let from = corpus.indexOf(name);
  for (let seen = 0; from >= 0 && seen < 8; seen += 1) {
    if (pattern.test(corpus.slice(from + name.length, from + name.length + PRICE_WINDOW))) return true;
    from = corpus.indexOf(name, from + 1);
  }
  return false;
}

function item(value: unknown, corpus: string): SiteItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const name = text(row.name, 120);
  if (name === null) return null;
  const grounded = groundingText(name);
  if (grounded === '' || !corpus.includes(grounded)) return null;
  const cents = typeof row.priceCents === 'number' && Number.isInteger(row.priceCents)
    && row.priceCents > 0 && row.priceCents <= MAX_PRICE_CENTS ? row.priceCents : null;
  return {
    name,
    description: text(row.description, 300),
    priceCents: cents !== null && priceNearName(corpus, grounded, cents) ? cents : null,
    category: text(row.category, 60),
  };
}

/**
 * The model's answer, checked against the crawl, or null when it is not a
 * brand kit at all.
 */
export function parseExtraction(raw: unknown, crawl: SiteCrawl): SiteExtraction | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.summary !== 'string' || !Array.isArray(row.colors) || !Array.isArray(row.items)) return null;
  const corpus = groundingText(crawl.pages.map((page) => page.text).join('\n'));
  const colors = [...new Set(row.colors
    .filter((color): color is string => typeof color === 'string' && HEX_COLOR.test(color))
    .map((color) => color.toUpperCase()))].slice(0, 8);
  const offered = new Set(crawl.logos.map((logo) => logo.url));
  const logoUrl = typeof row.logoUrl === 'string' && offered.has(row.logoUrl) ? row.logoUrl : null;
  const items: SiteItem[] = [];
  let ungroundedItems = 0;
  for (const entry of row.items.slice(0, MAX_ITEMS)) {
    const parsed = item(entry, corpus);
    if (parsed === null) ungroundedItems += 1;
    else if (!items.some((kept) => kept.name.toLowerCase() === parsed.name.toLowerCase() && kept.category === parsed.category)) {
      items.push(parsed);
    }
  }
  const confidence = typeof row.confidence === 'number' && Number.isFinite(row.confidence)
    ? Math.min(1, Math.max(0, row.confidence)) : 0;
  return { summary: row.summary.replace(/\s+/g, ' ').trim(), colors, logoUrl, items, confidence, ungroundedItems };
}

/**
 * Worth a second read by a stronger model: the model doubted itself, the
 * kit is missing what a brand needs, or more than half its items were not on
 * the site.
 */
export function isLowConfidence(extraction: SiteExtraction): boolean {
  const returned = extraction.items.length + extraction.ungroundedItems;
  return extraction.confidence < MIN_CONFIDENCE
    || extraction.colors.length < 2
    || extraction.summary.length < 20
    || (returned > 0 && extraction.ungroundedItems * 2 > returned);
}
