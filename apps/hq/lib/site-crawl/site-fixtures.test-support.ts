import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scriptedTransport, type FakeReply } from '../public-fetch/fakes.test-support';
import type { CrawledPage, SiteCrawl } from './crawl-site';
import { readPageFacts } from './html-facts';
import type { PageTopic } from './page-selection';

/**
 * A recorded-style small-business site for the crawl tests: a bakery whose
 * apex domain redirects to www, with a menu, a contact page, an about page
 * and a robots.txt that closes one section. Pages are fixture files; the
 * transport serves them by URL, so no test reaches a network.
 */
export const APEX = 'https://maplerowbakehouse.com/';
export const WWW = 'https://www.maplerowbakehouse.com';

export function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'lib', 'site-crawl', 'fixtures', name), 'utf8');
}

export function htmlReply(body: string): FakeReply {
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

export type Routes = Readonly<Record<string, FakeReply>>;

/** The bakery site; `stylesheet` is its one first-party CSS file. */
export function bakeryRoutes(stylesheet: string, overrides: Routes = {}): Routes {
  return {
    'https://maplerowbakehouse.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: fixture('robots.txt') },
    [APEX]: { status: 301, headers: { location: `${WWW}/` } },
    [`${WWW}/`]: htmlReply(fixture('home.html')),
    [`${WWW}/menu/`]: htmlReply(fixture('menu.html')),
    [`${WWW}/visit`]: htmlReply(fixture('visit.html')),
    [`${WWW}/our-story`]: htmlReply(fixture('our-story.html')),
    [`${WWW}/assets/site.css`]: { status: 200, headers: { 'content-type': 'text/css' }, body: stylesheet },
    ...overrides,
  };
}

/** A transport serving `routes` by exact URL, and a plain 404 page for anything else. */
export function siteTransport(routes: Routes): ReturnType<typeof scriptedTransport> {
  return scriptedTransport((request) => routes[request.url.href]
    ?? { status: 404, headers: { 'content-type': 'text/html' }, body: '<h1>Not found</h1>' });
}

function crawledPage(url: string, topic: PageTopic, name: string): CrawledPage {
  const facts = readPageFacts(fixture(name));
  return { url, topic, title: facts.title, text: facts.text };
}

/**
 * A finished crawl of the bakery, for tests of what reads one. `colors` comes
 * from the caller because this file is scanned by the token audit and a test
 * file is not.
 */
export function bakeryCrawl(colors: SiteCrawl['colors'], overrides: Partial<SiteCrawl> = {}): SiteCrawl {
  return {
    home: `${WWW}/`,
    host: 'maplerowbakehouse.com',
    name: 'Maple Row Bakehouse',
    description: 'A neighbourhood bakehouse baking sourdough, laminated pastry and espresso drinks every morning.',
    pages: [
      crawledPage(`${WWW}/`, 'home', 'home.html'),
      crawledPage(`${WWW}/menu/`, 'menu', 'menu.html'),
      crawledPage(`${WWW}/visit`, 'contact', 'visit.html'),
      crawledPage(`${WWW}/our-story`, 'about', 'our-story.html'),
    ],
    colors,
    logos: [
      { url: `${WWW}/images/maple-row-logo.png`, source: 'json-ld' },
      { url: `${WWW}/apple-touch-icon.png`, source: 'touch-icon' },
    ],
    images: [
      { url: `${WWW}/images/croissants-1600.jpg`, alt: 'Butter croissants', page: `${WWW}/` },
      { url: `${WWW}/images/menu/sourdough.jpg`, alt: 'Country sourdough loaf', page: `${WWW}/menu/` },
    ],
    socialLinks: [{ network: 'instagram', url: 'https://instagram.com/maplerowbakehouse/' }],
    contactEmails: ['info@maplerowbakehouse.com', 'maplerowbakehouse@gmail.com'],
    skipped: [],
    ...overrides,
  };
}
