import assert from 'node:assert/strict';
import test from 'node:test';

import { CrawlBudget } from '../public-fetch';
import { DEMO_BUILDER_PRODUCT_TOKEN } from '../public-fetch/user-agent';
import { SiteCrawlError } from './crawl-fetch';
import { crawlSite } from './crawl-site';
import { APEX, WWW, bakeryRoutes, fixture, htmlReply, siteTransport } from './site-fixtures.test-support';

const STYLESHEET = ':root { --color-primary: var(--palette-forest); --palette-forest: #2F5D3A; } body { color: #333333; }';
/** The homepage's share image, on a host of its own. */
const SHARE_IMAGE = 'https://cdn.maplerowbakehouse.com/share/storefront.jpg';

async function crawlError(promise: Promise<unknown>): Promise<SiteCrawlError> {
  let outcome: unknown = 'resolved';
  try {
    await promise;
  } catch (error) {
    outcome = error;
  }
  assert.ok(outcome instanceof SiteCrawlError, `expected a SiteCrawlError, got ${String(outcome)}`);
  return outcome;
}

test('a site is read robots-first, homepage next, then its best pages and one stylesheet', async () => {
  const transport = siteTransport(bakeryRoutes(STYLESHEET));
  const crawl = await crawlSite('maplerowbakehouse.com', { transport });
  assert.deepEqual(transport.requests.map((request) => request.url.href), [
    'https://maplerowbakehouse.com/robots.txt',
    APEX,
    `${WWW}/`,
    `${WWW}/menu/`,
    // Both in the nav; a contact page outranks an about page.
    `${WWW}/visit`,
    `${WWW}/our-story`,
    `${WWW}/assets/site.css`,
    // The share image is on another host, which has a robots.txt of its own.
    'https://cdn.maplerowbakehouse.com/robots.txt',
  ]);
  assert.equal(crawl.home, `${WWW}/`);
  assert.equal(crawl.host, 'maplerowbakehouse.com');
  assert.equal(crawl.name, 'Maple Row Bakehouse');
  assert.deepEqual(crawl.pages.map((page) => page.topic), ['home', 'menu', 'contact', 'about']);
  assert.equal(crawl.description, 'A neighbourhood bakehouse baking sourdough, laminated pastry and espresso drinks every morning.');
  assert.deepEqual(crawl.skipped, []);
});

test('robots.txt closes a section, and cart, blog and file links are never fetched', async () => {
  const transport = siteTransport(bakeryRoutes(STYLESHEET));
  await crawlSite('https://maplerowbakehouse.com', { transport });
  const fetched = transport.requests.map((request) => request.url.pathname);
  for (const path of ['/catering', '/cart', '/menu.pdf', '/blog/2023/05/new-oven']) assert.ok(!fetched.includes(path), path);
  assert.equal(transport.requests[0]?.headers['user-agent']?.includes(DEMO_BUILDER_PRODUCT_TOKEN), true);
});

test('the crawl assembles colours, logos, photographs, profiles and contact emails', async () => {
  const crawl = await crawlSite('maplerowbakehouse.com', { transport: siteTransport(bakeryRoutes(STYLESHEET)) });
  assert.deepEqual(crawl.colors.slice(0, 3).map((color) => color.hex), ['#7A3E1D', '#2F5D3A', '#E8A948']);
  assert.equal(crawl.logos[0]?.source, 'json-ld');
  assert.ok(crawl.images.some((image) => image.url.endsWith('/images/menu/sourdough.jpg')));
  assert.ok(!crawl.images.some((image) => image.url.includes('team@2x')), 'contact-page pictures are not menu photographs');
  assert.deepEqual(crawl.socialLinks.map((link) => link.network), ['instagram', 'facebook', 'tiktok']);
  assert.deepEqual(crawl.contactEmails, [
    'info@maplerowbakehouse.com',
    'hello@maplerowbakehouse.com',
    'orders@maplerowbakehouse.com',
    'maplerowbakehouse@gmail.com',
  ]);
  const menu = crawl.pages.find((page) => page.topic === 'menu');
  assert.match(menu?.text ?? '', /Country Sourdough \$9\.00/);
});

test('pictures the site closes to crawlers are not offered for download', async () => {
  const transport = siteTransport(bakeryRoutes(STYLESHEET, {
    'https://maplerowbakehouse.com/robots.txt': {
      status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /images/menu/\nDisallow: /apple-touch-icon.png',
    },
  }));
  const crawl = await crawlSite('maplerowbakehouse.com', { transport });
  assert.ok(crawl.pages.some((page) => page.topic === 'menu'), 'the menu page itself is still open');
  assert.ok(!crawl.images.some((image) => image.url.includes('/images/menu/')));
  assert.ok(crawl.images.some((image) => image.url.endsWith('/images/croissants-1600.jpg')));
  assert.ok(!crawl.logos.some((logo) => logo.url.endsWith('/apple-touch-icon.png')));
  assert.equal(crawl.logos[0]?.source, 'json-ld');
});

test("a picture on another host follows that host's robots.txt, not the site's", async () => {
  const open = await crawlSite('maplerowbakehouse.com', { transport: siteTransport(bakeryRoutes(STYLESHEET)) });
  assert.ok(open.images.some((image) => image.url === SHARE_IMAGE), 'a host with no robots.txt closes nothing');
  const transport = siteTransport(bakeryRoutes(STYLESHEET, {
    'https://cdn.maplerowbakehouse.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /share/' },
  }));
  const crawl = await crawlSite('maplerowbakehouse.com', { transport });
  assert.ok(![...crawl.images, ...crawl.logos].some((picture) => picture.url === SHARE_IMAGE));
  assert.ok(crawl.images.some((image) => image.url.endsWith('/images/croissants-1600.jpg')), "the site's own pictures are unaffected");
  assert.equal(transport.requests.filter((request) => request.url.hostname === 'cdn.maplerowbakehouse.com').length, 1);
});

test('a missing robots.txt allows the crawl; an unreadable one forbids it', async () => {
  const missing = siteTransport(bakeryRoutes(STYLESHEET, {
    'https://maplerowbakehouse.com/robots.txt': { status: 404, headers: { 'content-type': 'text/html' }, body: 'nope' },
  }));
  const crawl = await crawlSite('maplerowbakehouse.com', { transport: missing });
  assert.ok(missing.requests.some((request) => request.url.pathname === '/catering'), 'with no robots.txt nothing is closed');
  assert.deepEqual(crawl.skipped, [{ url: `${WWW}/catering`, reason: 'http_status' }]);

  const broken = siteTransport(bakeryRoutes(STYLESHEET, {
    'https://maplerowbakehouse.com/robots.txt': { status: 503, headers: { 'content-type': 'text/plain' }, body: 'down' },
  }));
  assert.equal((await crawlError(crawlSite('maplerowbakehouse.com', { transport: broken }))).code, 'disallowed');
  assert.ok(!broken.requests.some((request) => request.url.pathname === '/'), 'no page is read after robots.txt fails');
});

test('a site that closes itself to all crawlers is not read at all', async () => {
  const transport = siteTransport(bakeryRoutes(STYLESHEET, {
    'https://maplerowbakehouse.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /' },
  }));
  assert.equal((await crawlError(crawlSite('maplerowbakehouse.com', { transport }))).code, 'disallowed');
  assert.equal(transport.requests.length, 1);
});

test('a listing that points at a social profile or a dead site gives nothing to build from', async () => {
  const social = siteTransport({
    'https://maplerowbakehouse.com/robots.txt': { status: 404, headers: { 'content-type': 'text/plain' }, body: '' },
    [APEX]: { status: 302, headers: { location: 'https://www.instagram.com/maplerowbakehouse/' } },
    'https://www.instagram.com/maplerowbakehouse/': htmlReply(fixture('our-story.html')),
  });
  assert.equal((await crawlError(crawlSite('maplerowbakehouse.com', { transport: social }))).code, 'not_a_site');

  const dead = siteTransport({});
  assert.equal((await crawlError(crawlSite('maplerowbakehouse.com', { transport: dead }))).code, 'unreachable');
  assert.equal((await crawlError(crawlSite('http://10.0.0.8/', { transport: dead }))).code, 'invalid_site');
  assert.equal((await crawlError(crawlSite('not a website at all', { transport: dead }))).code, 'invalid_site');
});

test('a social profile or link-in-bio address is refused before a single request', async () => {
  for (const website of ['https://www.facebook.com/maplerowbakehouse', 'instagram.com/maplerowbakehouse', 'https://linktr.ee/maplerow']) {
    const transport = siteTransport(bakeryRoutes(STYLESHEET));
    assert.equal((await crawlError(crawlSite(website, { transport }))).code, 'not_a_site', website);
    assert.equal(transport.requests.length, 0, website);
  }
});

test('a homepage that moved to another site is read only if that site allows it', async () => {
  const moved = (robots: string) => siteTransport({
    'https://maplerowbakehouse.com/robots.txt': { status: 404, headers: { 'content-type': 'text/plain' }, body: '' },
    [APEX]: { status: 301, headers: { location: 'https://maplerow.shop/' } },
    'https://maplerow.shop/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: robots },
    'https://maplerow.shop/': htmlReply(fixture('home.html')),
  });
  const closed = moved('User-agent: *\nDisallow: /');
  assert.equal((await crawlError(crawlSite('maplerowbakehouse.com', { transport: closed }))).code, 'disallowed');
  assert.deepEqual(closed.requests.map((request) => request.url.href), [
    'https://maplerowbakehouse.com/robots.txt', APEX, 'https://maplerow.shop/', 'https://maplerow.shop/robots.txt',
  ]);
  const open = moved('User-agent: *\nDisallow: /visit');
  const crawl = await crawlSite('maplerowbakehouse.com', { transport: open });
  assert.equal(crawl.host, 'maplerow.shop');
  assert.ok(!open.requests.some((request) => request.url.href === 'https://maplerow.shop/visit'), "the new site's rules apply");
});

test('pages that fail are skipped and recorded, and a spent budget stops the crawl', async () => {
  const transport = siteTransport(bakeryRoutes(STYLESHEET, {
    [`${WWW}/menu/`]: { status: 500, headers: { 'content-type': 'text/html' }, body: 'oops' },
  }));
  const crawl = await crawlSite('maplerowbakehouse.com', { transport });
  assert.deepEqual(crawl.skipped, [{ url: `${WWW}/menu/`, reason: 'http_status' }]);
  assert.ok(!crawl.pages.some((page) => page.topic === 'menu'));

  const tight = await crawlSite('maplerowbakehouse.com', {
    transport: siteTransport(bakeryRoutes(STYLESHEET)),
    budget: new CrawlBudget({ maxRequests: 4, maxBytes: 10_000_000, deadlineMs: 60_000 }),
  });
  assert.deepEqual(tight.pages.map((page) => page.topic), ['home', 'menu']);
  assert.ok(tight.skipped.some((entry) => entry.reason === 'budget_exhausted'));
});
