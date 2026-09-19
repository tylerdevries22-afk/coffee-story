import assert from 'node:assert/strict';
import test from 'node:test';

import { CrawlBudget } from '../public-fetch';
import type { FakeReply } from '../public-fetch/fakes.test-support';
import { MAX_ASSET_ORIGINS, assetPermission } from './asset-robots';
import type { RobotsRules } from './robots';
import { siteTransport, type Routes } from './site-fixtures.test-support';

const HOME = new URL('https://www.maplerowbakehouse.com/');
const HOME_RULES: RobotsRules = { allow: [], disallow: ['/private/'] };

function robotsFile(body: string): FakeReply {
  return { status: 200, headers: { 'content-type': 'text/plain' }, body };
}

async function permission(urls: readonly string[], routes: Routes, budget = new CrawlBudget()) {
  const transport = siteTransport(routes);
  const allowed = await assetPermission(urls, HOME, HOME_RULES, { budget, transport });
  // Distinct and sorted: the files are read concurrently, and a retry repeats one.
  const fetched = [...new Set(transport.requests.map((request) => request.url.href))].sort();
  return { allowed, fetched };
}

test('same-site pictures follow the rules the crawl already read, at no extra request', async () => {
  const { allowed, fetched } = await permission([
    'https://www.maplerowbakehouse.com/images/loaf.jpg',
    'https://maplerowbakehouse.com/private/owner.jpg',
  ], {});
  assert.deepEqual(fetched, []);
  assert.equal(allowed('https://www.maplerowbakehouse.com/images/loaf.jpg'), true);
  assert.equal(allowed('https://maplerowbakehouse.com/private/owner.jpg'), false, 'www and the bare domain are one site');
});

test("a picture on another host follows that host's own robots.txt, read once per host", async () => {
  const { allowed, fetched } = await permission([
    'https://images.cdnhost.example/shop/logo.png',
    'https://images.cdnhost.example/private/banner.jpg',
    'https://photos.otherhost.example/menu/tart.jpg',
  ], {
    'https://images.cdnhost.example/robots.txt': robotsFile('User-agent: *\nDisallow: /private/'),
  });
  assert.deepEqual(fetched, ['https://images.cdnhost.example/robots.txt', 'https://photos.otherhost.example/robots.txt']);
  assert.equal(allowed('https://images.cdnhost.example/shop/logo.png'), true);
  assert.equal(allowed('https://images.cdnhost.example/private/banner.jpg'), false);
  assert.equal(allowed('https://photos.otherhost.example/menu/tart.jpg'), true, 'a host with no robots.txt closes nothing');
  assert.equal(allowed('https://www.maplerowbakehouse.com/private/menu.jpg'), false, "the site's own rules still apply to it");
});

test('a host whose robots.txt cannot be read offers nothing', async () => {
  const { allowed } = await permission(['https://images.cdnhost.example/logo.png'], {
    'https://images.cdnhost.example/robots.txt': { status: 503, headers: { 'content-type': 'text/plain' }, body: 'down' },
  });
  assert.equal(allowed('https://images.cdnhost.example/logo.png'), false);
});

test('only the first few other hosts are asked, and pictures past them are not offered', async () => {
  const hosts = Array.from({ length: MAX_ASSET_ORIGINS + 2 }, (_, index) => `https://img${index}.cdnhost.example`);
  const { allowed, fetched } = await permission(hosts.map((host) => `${host}/photo.jpg`), {});
  assert.deepEqual(fetched, hosts.slice(0, MAX_ASSET_ORIGINS).map((host) => `${host}/robots.txt`));
  assert.equal(allowed(`${hosts[0]}/photo.jpg`), true);
  assert.equal(allowed(`${hosts[MAX_ASSET_ORIGINS]}/photo.jpg`), false);
});

test('a spent budget withholds other hosts instead of failing the crawl', async () => {
  const spent = new CrawlBudget({ maxRequests: 0, maxBytes: 1, deadlineMs: 1_000 });
  const { allowed, fetched } = await permission([
    'https://images.cdnhost.example/logo.png',
    'https://www.maplerowbakehouse.com/logo.png',
  ], {}, spent);
  assert.deepEqual(fetched, []);
  assert.equal(allowed('https://images.cdnhost.example/logo.png'), false);
  assert.equal(allowed('https://www.maplerowbakehouse.com/logo.png'), true, 'a same-site picture needs no request');
});

test('an address that is not a plain https URL is never offered', async () => {
  const { allowed, fetched } = await permission(['not a url', 'ftp://files.cdnhost.example/logo.png'], {});
  assert.deepEqual(fetched, []);
  assert.equal(allowed('not a url'), false);
  assert.equal(allowed('ftp://files.cdnhost.example/logo.png'), false);
});
