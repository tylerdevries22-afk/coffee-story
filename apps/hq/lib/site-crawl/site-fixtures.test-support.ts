import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scriptedTransport, type FakeReply } from '../public-fetch/fakes.test-support';

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
