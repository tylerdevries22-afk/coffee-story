import type { LinkFact } from './html-facts';

/**
 * Which of a site's pages are worth one of the crawl's eight fetches.
 *
 * A demo needs what the business sells and how to reach it, so links whose
 * address or label reads like a menu, services, about or contact page win;
 * navigation links come next, because a site's own nav is where its real
 * sections live. Everything else -- carts, logins, legal pages, blog archives,
 * files -- is never fetched. Only same-site pages are candidates, and `www.`
 * and the bare domain are one site.
 */
export type PageTopic = 'menu' | 'services' | 'about' | 'contact' | 'home' | 'other';

export const MAX_PAGES = 8;

const TOPIC_WORDS: readonly (readonly [Exclude<PageTopic, 'home' | 'other'>, readonly string[]])[] = [
  ['menu', ['menu', 'menus', 'food', 'drinks', 'drink', 'eat', 'dishes', 'breakfast', 'brunch', 'lunch', 'dinner', 'bakery', 'pastries', 'order', 'coffee']],
  ['services', ['services', 'service', 'pricing', 'prices', 'price', 'rates', 'treatments', 'packages', 'offerings', 'products', 'shop', 'catering', 'specials', 'what-we-do', 'rooms', 'amenities']],
  ['contact', ['contact', 'contact-us', 'location', 'locations', 'hours', 'visit', 'find-us', 'directions']],
  ['about', ['about', 'about-us', 'our-story', 'story', 'team', 'who-we-are', 'history', 'mission']],
];
const SCORE: Readonly<Record<PageTopic, number>> = { menu: 4, services: 4, contact: 3, about: 2, home: 0, other: 0 };

const NEVER = /(?:^|\/)(?:cart|checkout|basket|login|log-in|signin|sign-in|register|account|my-account|wp-admin|wp-login|admin|privacy|terms|cookie|cookies|legal|accessibility|feed|rss|tag|tags|category|author|search|careers|jobs)(?:\.[a-z0-9]+)?(?:\/|$)/;
const PAGE_EXTENSION = /\.(?:html?|php|aspx?)$/;

/** The host with a leading `www.` removed: apex and www are one site. */
export function siteHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

export function sameSite(a: URL, b: URL): boolean {
  return siteHost(a) === siteHost(b);
}

function words(url: URL, label: string): string[] {
  const path = decodeURIComponentSafe(url.pathname).toLowerCase();
  return [...path.split(/[/_.\-\s]+/), path.replace(/^\/|\/$/g, ''), ...label.toLowerCase().split(/\s+/)].filter(Boolean);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** What a page is about, judged from its address and the label that linked to it. */
export function pageTopic(url: URL, label = ''): PageTopic {
  if (url.pathname === '/' || url.pathname === '') return 'home';
  const found = new Set(words(url, label));
  for (const [topic, list] of TOPIC_WORDS) {
    if (list.some((word) => found.has(word))) return topic;
  }
  return 'other';
}

/** The page URL a same-site link points to, or null when it is not a crawlable page. */
export function pageUrl(href: string, base: URL, home: URL): URL | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !sameSite(url, home)) return null;
  // A same-site http:// link is the same page; the crawler only speaks https.
  url.protocol = 'https:';
  url.hash = '';
  const path = url.pathname.toLowerCase();
  const extension = /\.[a-z0-9]{1,5}$/.exec(path);
  if (extension !== null && !PAGE_EXTENSION.test(path)) return null;
  if (NEVER.test(path)) return null;
  return url;
}

function canonical(url: URL): string {
  return `${siteHost(url)}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
}

export type PageCandidate = { readonly url: URL; readonly topic: PageTopic; readonly score: number };

/**
 * Up to `limit` pages to fetch after the homepage, best first. A link
 * earns a place by its topic or by sitting in the site's own navigation;
 * `allowed` is the robots.txt verdict for a URL.
 */
export function choosePages(
  links: readonly LinkFact[],
  home: URL,
  allowed: (url: URL) => boolean,
  limit = MAX_PAGES - 1,
): PageCandidate[] {
  const seen = new Set([canonical(home)]);
  const candidates: (PageCandidate & { order: number })[] = [];
  links.forEach((link, order) => {
    const url = pageUrl(link.href, home, home);
    if (url === null || seen.has(canonical(url)) || !allowed(url)) return;
    seen.add(canonical(url));
    const topic = pageTopic(url, link.text);
    const score = SCORE[topic] + (link.inChrome ? 1 : 0);
    if (score > 0) candidates.push({ url, topic, score, order });
  });
  return candidates
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ url, topic, score }) => ({ url, topic, score }));
}
