import {
  DEMO_BUILDER_PRODUCT_TOKEN, PublicFetchError, fetchPublic, parsePublicUrl, type PublicFetchOptions,
} from '../public-fetch';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type RobotsRules } from './robots';

/**
 * The crawl's two network questions: what may be read, and what a page says.
 *
 * Both go through the hardened public fetch, so every address rule, size cap
 * and budget in lib/public-fetch applies to the crawl without being restated
 * here.
 */
export type SiteCrawlErrorCode = 'invalid_site' | 'unreachable' | 'disallowed' | 'not_a_site';

const MESSAGES: Readonly<Record<SiteCrawlErrorCode, string>> = {
  invalid_site: 'The website address is not a public HTTPS site.',
  unreachable: 'The website could not be read.',
  disallowed: "The website's robots.txt asks crawlers not to read it.",
  not_a_site: 'The website address points at a social profile or link page, not a site.',
};

/** Why a site yielded nothing to build from; the caller falls back to search. */
export class SiteCrawlError extends Error {
  constructor(readonly code: SiteCrawlErrorCode, options: { cause?: unknown } = {}) {
    super(MESSAGES[code], { cause: options.cause });
    this.name = 'SiteCrawlError';
  }
}

const TRACKING_PARAMETER = /^(?:utm_[a-z]+|gclid|fbclid|msclkid)$/i;

/**
 * Where to start: the listing's website, given a scheme when it has none,
 * upgraded to https, and stripped of campaign tracking a listing appends.
 */
export function websiteStart(website: string): URL {
  const trimmed = website.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch (error) {
    throw new SiteCrawlError('invalid_site', { cause: error });
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
  try {
    return parsePublicUrl(url);
  } catch (error) {
    throw new SiteCrawlError('invalid_site', { cause: error });
  }
}

/**
 * The robots.txt rules for an origin, read as RFC 9309 prescribes: a file
 * that is missing (any 4xx, or an HTML page served in its place) allows
 * everything; a file that cannot be read (5xx, timeout, refused) forbids
 * everything, because "we could not ask" is not permission.
 */
export async function robotsRulesFor(origin: URL, options: PublicFetchOptions): Promise<RobotsRules> {
  try {
    const result = await fetchPublic(new URL('/robots.txt', origin), 'robots', options);
    return parseRobots(result.body.toString('utf8'), DEMO_BUILDER_PRODUCT_TOKEN);
  } catch (error) {
    if (!(error instanceof PublicFetchError)) throw error;
    if (error.code === 'budget_exhausted') throw error;
    const missing = (error.code === 'http_status' && error.status !== undefined && error.status >= 400 && error.status < 500)
      || error.code === 'wrong_type' || error.code === 'redirect_limit';
    return missing ? ALLOW_ALL : DISALLOW_ALL;
  }
}

/** Text in the charset the server declared, or UTF-8 when it named none it can decode. */
export function decodeText(body: Buffer, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export type FetchedPage = { readonly url: URL; readonly html: string };

/** One HTML page and the address it finally came from. */
export async function fetchPage(url: URL, options: PublicFetchOptions): Promise<FetchedPage> {
  const result = await fetchPublic(url, 'html', options);
  return { url: result.url, html: decodeText(result.body, result.charset) };
}

/** One stylesheet's text, or null when it cannot be read; colours are a nice-to-have. */
export async function fetchStylesheet(url: URL, options: PublicFetchOptions): Promise<string | null> {
  try {
    const result = await fetchPublic(url, 'css', options);
    return decodeText(result.body, result.charset);
  } catch (error) {
    if (error instanceof PublicFetchError && error.code === 'budget_exhausted') throw error;
    return null;
  }
}
