import assert from 'node:assert/strict';
import test from 'node:test';

import { CrawlBudget, PublicFetchError } from '../public-fetch';
import { scriptedTransport, type FakeReply } from '../public-fetch/fakes.test-support';
import { SiteCrawlError, decodeText, fetchPage, fetchStylesheet, robotsRulesFor, websiteStart } from './crawl-fetch';
import { ALLOW_ALL, DISALLOW_ALL, type RobotsRules } from './robots';

const SITE = new URL('https://maplerowbakehouse.com/');
const E_ACUTE = String.fromCharCode(0xe9);

function answering(reply: (url: URL) => FakeReply) {
  return { transport: scriptedTransport((request) => reply(request.url)), budget: new CrawlBudget() };
}

function spent(): CrawlBudget {
  return new CrawlBudget({ maxRequests: 0, maxBytes: 1, deadlineMs: 1_000 });
}

function isBudgetError(error: unknown): boolean {
  return error instanceof PublicFetchError && error.code === 'budget_exhausted';
}

function siteError(run: () => unknown): SiteCrawlError {
  let outcome: unknown = 'returned';
  try {
    run();
  } catch (error) {
    outcome = error;
  }
  assert.ok(outcome instanceof SiteCrawlError, `expected a SiteCrawlError, got ${String(outcome)}`);
  return outcome;
}

test('a listing website becomes an https start address without campaign tracking', () => {
  assert.equal(websiteStart('maplerowbakehouse.com').href, 'https://maplerowbakehouse.com/');
  assert.equal(
    websiteStart(' http://www.maplerowbakehouse.com/?utm_source=maps&gclid=x&FBCLID=y&table=4 ').href,
    'https://www.maplerowbakehouse.com/?table=4',
  );
  assert.equal(websiteStart('https://maplerowbakehouse.com:443/menu#drinks').href, 'https://maplerowbakehouse.com/menu');
});

test('an address that is not a public https site is refused before anything is fetched', () => {
  for (const website of [
    '', 'not a website at all', 'ftp://maplerowbakehouse.com/', 'https://localhost/', 'https://10.0.0.8/',
    'https://guest@maplerowbakehouse.com/', 'https://maplerowbakehouse.com:8443/',
  ]) {
    assert.equal(siteError(() => websiteStart(website)).code, 'invalid_site', website);
  }
  assert.ok(siteError(() => websiteStart('https://10.0.0.8/')).cause instanceof PublicFetchError);
});

test('robots.txt is read for our own product token first', async () => {
  const text = 'User-agent: *\nDisallow: /\n\nUser-agent: OrderingDemoBuilder\nDisallow: /private\n';
  const options = answering(() => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: text }));
  assert.deepEqual(await robotsRulesFor(new URL('/menu/', SITE), options), { allow: [], disallow: ['/private'] });
  assert.equal(options.transport.requests[0]?.url.href, 'https://maplerowbakehouse.com/robots.txt');
});

test('a missing robots.txt allows everything; one that cannot be read allows nothing', async () => {
  const cases: [FakeReply, RobotsRules][] = [
    [{ status: 404, headers: { 'content-type': 'text/html' }, body: 'missing' }, ALLOW_ALL],
    [{ status: 410 }, ALLOW_ALL],
    // A homepage served in place of the file is a missing file.
    [{ status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>Welcome</h1>' }, ALLOW_ALL],
    [{ status: 301, headers: { location: '/robots.txt' } }, ALLOW_ALL],
    [{ status: 500, headers: { 'content-type': 'text/plain' } }, DISALLOW_ALL],
  ];
  for (const [reply, expected] of cases) {
    assert.deepEqual(await robotsRulesFor(SITE, answering(() => reply)), expected, JSON.stringify(reply));
  }
});

test('an unreachable robots.txt is retried once and then read as "keep out"', async () => {
  const transport = scriptedTransport(() => {
    throw new Error('connect ECONNRESET');
  });
  assert.deepEqual(await robotsRulesFor(SITE, { transport, budget: new CrawlBudget() }), DISALLOW_ALL);
  assert.equal(transport.requests.length, 2);
});

test('a spent budget is never mistaken for permission', async () => {
  const transport = scriptedTransport(() => ({ status: 404 }));
  await assert.rejects(robotsRulesFor(SITE, { transport, budget: spent() }), isBudgetError);
  assert.equal(transport.requests.length, 0);
});

test('text is decoded in the declared charset, or as UTF-8 when that is unknown', () => {
  assert.equal(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'iso-8859-1'), `caf${E_ACUTE}`);
  const utf8 = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]);
  assert.equal(decodeText(utf8, null), `caf${E_ACUTE}`);
  assert.equal(decodeText(utf8, 'x-not-a-charset'), `caf${E_ACUTE}`);
});

test('a page comes back with the address it finally came from', async () => {
  const options = answering((url) => (url.hostname === 'maplerowbakehouse.com'
    ? { status: 301, headers: { location: 'https://www.maplerowbakehouse.com/' } }
    : { status: 200, headers: { 'content-type': 'text/html; charset=iso-8859-1' }, body: Buffer.from([0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9]) }));
  const page = await fetchPage(SITE, options);
  assert.equal(page.url.href, 'https://www.maplerowbakehouse.com/');
  assert.equal(page.html, `<p>caf${E_ACUTE}`);
});

test('a stylesheet that cannot be read is simply absent, unless the budget is spent', async () => {
  const sheet = new URL('https://www.maplerowbakehouse.com/assets/site.css');
  const css = answering(() => ({ status: 200, headers: { 'content-type': 'text/css' }, body: 'main { margin: 0 }' }));
  assert.equal(await fetchStylesheet(sheet, css), 'main { margin: 0 }');
  const login = answering(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<p>Sign in</p>' }));
  assert.equal(await fetchStylesheet(sheet, login), null);
  const missing = answering(() => ({ status: 404 }));
  assert.equal(await fetchStylesheet(sheet, missing), null);
  await assert.rejects(fetchStylesheet(sheet, { transport: missing.transport, budget: spent() }), isBudgetError);
});
