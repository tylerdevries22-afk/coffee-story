import { CrawlBudget, PublicFetchError, type PublicFetchOptions } from '../public-fetch';
import { contactEmails, emailsInMailto, emailsInText } from './contact-emails';
import {
  SiteCrawlError, fetchPage, fetchStylesheet, robotsRulesFor, websiteStart,
} from './crawl-fetch';
import { paletteCandidates, type ColorCandidate } from './css-colors';
import { readPageFacts, type PageFacts } from './html-facts';
import { readJsonLd } from './json-ld';
import { imageCandidates, logoCandidates, type ImageCandidate, type LogoCandidate } from './media-candidates';
import { MAX_PAGES, choosePages, sameSite, siteHost, type PageTopic } from './page-selection';
import { robotsAllows, type RobotsRules } from './robots';
import { socialLinks, socialNetwork, type SocialLink } from './social-links';

/**
 * Reads a business's own website into plain facts: at most eight same-site
 * pages (homepage first, then the ones that look like menu, services,
 * contact and about), up to three first-party stylesheets, and robots.txt
 * before any of them. Every fetch draws from one crawl budget. The result
 * is plain JSON, so it can cross a workflow step boundary unchanged.
 */
export type CrawledPage = {
  readonly url: string;
  readonly topic: PageTopic;
  readonly title: string | null;
  readonly text: string;
};

export type SiteCrawl = {
  readonly home: string;
  readonly host: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly pages: readonly CrawledPage[];
  readonly colors: readonly ColorCandidate[];
  readonly logos: readonly LogoCandidate[];
  readonly images: readonly ImageCandidate[];
  readonly socialLinks: readonly SocialLink[];
  readonly contactEmails: readonly string[];
  /** Pages that were chosen but could not be read, with the reason. */
  readonly skipped: readonly { readonly url: string; readonly reason: string }[];
};

export type CrawlOptions = Omit<PublicFetchOptions, 'budget'> & { readonly budget?: CrawlBudget | undefined };

const MAX_STYLESHEETS = 3;
const PAGE_CONCURRENCY = 2;
/** Link-in-bio services: a listing that points at one has no site of its own to read. */
const LINK_PAGES = /(?:^|\.)(?:linktr\.ee|beacons\.ai|linkin\.bio|taplink\.cc|lnk\.bio|carrd\.co)$/;

type Page = { readonly url: URL; readonly topic: PageTopic; readonly facts: PageFacts };

function reason(error: unknown): string {
  if (error instanceof PublicFetchError || error instanceof SiteCrawlError) return error.code;
  return 'network';
}

async function homePage(start: URL, options: PublicFetchOptions, rules: RobotsRules): Promise<Page> {
  if (!robotsAllows(rules, start.pathname + start.search)) throw new SiteCrawlError('disallowed');
  const fetched = await fetchPage(start, options).catch((error: unknown) => {
    throw new SiteCrawlError('unreachable', { cause: error });
  });
  if (socialNetwork(fetched.url) !== null || LINK_PAGES.test(fetched.url.hostname)) throw new SiteCrawlError('not_a_site');
  return { url: fetched.url, topic: 'home', facts: readPageFacts(fetched.html) };
}

async function subpages(home: Page, options: PublicFetchOptions, rules: RobotsRules, skipped: { url: string; reason: string }[]): Promise<Page[]> {
  const chosen = choosePages(home.facts.links, home.url, (url) => robotsAllows(rules, url.pathname + url.search), MAX_PAGES - 1);
  const pages: Page[] = [];
  for (let start = 0; start < chosen.length; start += PAGE_CONCURRENCY) {
    const batch = await Promise.allSettled(chosen.slice(start, start + PAGE_CONCURRENCY).map(async (candidate) => {
      const fetched = await fetchPage(candidate.url, options);
      // A page that redirected off the site is somebody else's content.
      if (!sameSite(fetched.url, home.url)) throw new SiteCrawlError('not_a_site');
      return { url: fetched.url, topic: candidate.topic, facts: readPageFacts(fetched.html) };
    }));
    batch.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') pages.push(outcome.value);
      else skipped.push({ url: chosen[start + index]?.url.href ?? '', reason: reason(outcome.reason) });
    });
    if (batch.some((outcome) => outcome.status === 'rejected' && reason(outcome.reason) === 'budget_exhausted')) break;
  }
  return pages;
}

async function stylesheets(home: Page, options: PublicFetchOptions, rules: RobotsRules): Promise<string[]> {
  const urls = home.facts.stylesheets
    .map((href) => pageUrlForAsset(href, home.url))
    .filter((url): url is URL => url !== null && robotsAllows(rules, url.pathname + url.search))
    .slice(0, MAX_STYLESHEETS);
  const sheets: string[] = [];
  for (const url of urls) {
    try {
      const css = await fetchStylesheet(url, options);
      if (css !== null) sheets.push(css);
    } catch {
      break;
    }
  }
  return sheets;
}

/** A first-party stylesheet address: same site, https, any extension. */
function pageUrlForAsset(href: string, home: URL): URL | null {
  try {
    const url = new URL(href, home);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' && sameSite(url, home) ? url : null;
  } catch {
    return null;
  }
}

function assemble(pages: readonly Page[], css: readonly string[], skipped: SiteCrawl['skipped']): SiteCrawl {
  const [home] = pages;
  if (home === undefined) throw new SiteCrawlError('unreachable');
  const structured = readJsonLd(pages.flatMap((page) => page.facts.jsonLd));
  const links = pages.flatMap((page) => page.facts.links);
  const themeColors = pages.map((page) => page.facts.meta['theme-color']).filter((value): value is string => Boolean(value));
  const readable = pages.filter((page) => page.topic === 'contact' || page.topic === 'about');
  const emails = [
    ...links.flatMap((link) => emailsInMailto(link.href)),
    ...structured.emails,
    ...readable.flatMap((page) => emailsInText(page.facts.text)),
  ];
  const meta = home.facts.meta;
  return {
    home: home.url.href,
    host: siteHost(home.url),
    name: clip(meta['og:site_name'] || meta['application-name'] || home.facts.title, 120),
    description: clip(meta.description || meta['og:description'], 500),
    pages: pages.map((page) => ({ url: page.url.href, topic: page.topic, title: clip(page.facts.title, 200), text: page.facts.text })),
    colors: paletteCandidates(themeColors, [...pages.flatMap((page) => page.facts.inlineStyles), ...css]),
    logos: logoCandidates(home.facts, home.url, structured.logos),
    images: imageCandidates(pages.filter((page) => page.topic !== 'about' && page.topic !== 'contact')),
    socialLinks: socialLinks([...structured.sameAs, ...links.map((link) => absolute(link.href, home.url))]),
    contactEmails: contactEmails(emails, siteHost(home.url)),
    skipped,
  };
}

/** Metadata is the site's to size; a demo needs a name and a sentence or two. */
function clip(value: string | null | undefined, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function absolute(href: string, base: URL): string {
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

/**
 * Crawls `website`. Throws `SiteCrawlError` when the site gives nothing to
 * build from -- not a public https address, unreachable, closed by robots.txt,
 * or not a site at all -- so the caller can fall back to searching instead.
 */
export async function crawlSite(website: string, options: CrawlOptions = {}): Promise<SiteCrawl> {
  const fetchOptions: PublicFetchOptions = { ...options, budget: options.budget ?? new CrawlBudget() };
  const start = websiteStart(website);
  const rules = await robotsRulesFor(start, fetchOptions);
  const home = await homePage(start, fetchOptions, rules);
  // A homepage that moved to another site is governed by that site's robots.txt.
  const homeRules = sameSite(home.url, start) ? rules : await robotsRulesFor(home.url, fetchOptions);
  const skipped: { url: string; reason: string }[] = [];
  const pages = [home, ...await subpages(home, fetchOptions, homeRules, skipped)];
  const css = await stylesheets(home, fetchOptions, homeRules);
  return assemble(pages, css, skipped);
}

