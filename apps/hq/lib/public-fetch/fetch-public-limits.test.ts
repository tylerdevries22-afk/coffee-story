import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { CrawlBudget } from './budget';
import { failure, never, page, redirect, scriptedTransport, type FakeReply } from './fakes.test-support';
import { fetchPublic } from './fetch-public';
import { KIND_POLICIES, type PublicFetchKind } from './kinds';

const KIB = 1024;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function budget(limits: Partial<{ maxRequests: number; maxBytes: number; deadlineMs: number }> = {}): CrawlBudget {
  return new CrawlBudget({ maxRequests: 40, maxBytes: 64 * 1024 * KIB, deadlineMs: 60_000, ...limits });
}

function css(body: string | Buffer | Readable, headers: Record<string, string> = {}): FakeReply {
  return { status: 200, headers: { 'content-type': 'text/css', ...headers }, body };
}

test('a declared length over the cap is refused without reading a byte', async () => {
  let pulled = false;
  const body = new Readable({ read() { pulled = true; this.push(null); } });
  const oversized = String(KIND_POLICIES.html.maxBytes + 1);
  const transport = scriptedTransport((): FakeReply => ({
    status: 200, headers: { 'content-type': 'text/html', 'content-length': oversized }, body,
  }));
  const error = await failure(fetchPublic('https://shop.example.com/', 'html', { budget: budget(), transport }));
  assert.equal(error.code, 'too_large');
  assert.equal(pulled, false);
  assert.equal(body.destroyed, true);
});

test('a body that streams past the cap is cut off at the cap', async () => {
  const chunks = Array.from({ length: 600 }, () => Buffer.alloc(KIB, 0x61));
  const body = Readable.from(chunks);
  const site = budget();
  const transport = scriptedTransport(() => css(body));
  assert.equal((await failure(fetchPublic('https://shop.example.com/site.css', 'css', { budget: site, transport }))).code, 'too_large');
  assert.equal(body.destroyed, true);
  assert.ok(site.usage().bytes <= KIND_POLICIES.css.maxBytes);
});

test('a body exactly at the cap is accepted', async () => {
  const transport = scriptedTransport(() => css(Buffer.alloc(KIND_POLICIES.css.maxBytes, 0x61)));
  const result = await fetchPublic('https://shop.example.com/site.css', 'css', { budget: budget(), transport });
  assert.equal(result.body.length, KIND_POLICIES.css.maxBytes);
});

test('the wrong media type, or none, is refused at the headers', async () => {
  const cases: [PublicFetchKind, string | undefined][] = [
    ['css', 'text/html'], ['image', 'image/svg+xml'], ['image', 'text/html; charset=utf-8'],
    ['html', 'application/json'], ['robots', 'text/html'], ['html', undefined], ['html', 'not a type'],
  ];
  for (const [kind, type] of cases) {
    const headers: Record<string, string> = type === undefined ? {} : { 'content-type': type };
    const transport = scriptedTransport((): FakeReply => ({ status: 200, headers, body: 'x' }));
    const error = await failure(fetchPublic('https://shop.example.com/file', kind, { budget: budget(), transport }));
    assert.equal(error.code, 'wrong_type', `${kind} as ${String(type)}`);
  }
});

test('an image has to be a raster format by its bytes, whatever its header says', async () => {
  const svg = scriptedTransport((): FakeReply => ({
    status: 200, headers: { 'content-type': 'image/png' }, body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  }));
  assert.equal((await failure(fetchPublic('https://shop.example.com/logo.png', 'image', { budget: budget(), transport: svg }))).code, 'wrong_type');
  const jpeg = scriptedTransport((): FakeReply => ({ status: 200, headers: { 'content-type': 'image/jpg' }, body: JPEG }));
  const result = await fetchPublic('https://shop.example.com/logo.jpg', 'image', { budget: budget(), transport: jpeg });
  assert.equal(result.mediaType, 'image/jpeg');
  assert.equal(result.charset, null);
});

test('a compressed body is decoded, and the cap applies to what it inflates to', async () => {
  const sheet = ':root { --brand: teal; }';
  const gzip = scriptedTransport(() => css(gzipSync(sheet), { 'content-encoding': 'gzip' }));
  assert.equal((await fetchPublic('https://shop.example.com/a.css', 'css', { budget: budget(), transport: gzip })).body.toString('utf8'), sheet);
  const brotli = scriptedTransport(() => css(brotliCompressSync(sheet), { 'content-encoding': 'br' }));
  assert.equal((await fetchPublic('https://shop.example.com/b.css', 'css', { budget: budget(), transport: brotli })).body.toString('utf8'), sheet);

  const bomb = gzipSync(Buffer.alloc(4 * 1024 * KIB));
  assert.ok(bomb.length < 16 * KIB, 'the payload is small on the wire');
  const site = budget();
  const bombing = scriptedTransport(() => css(bomb, { 'content-encoding': 'gzip', 'content-length': String(bomb.length) }));
  assert.equal((await failure(fetchPublic('https://shop.example.com/c.css', 'css', { budget: site, transport: bombing }))).code, 'too_large');
  assert.ok(site.usage().bytes <= KIND_POLICIES.css.maxBytes);
});

test('a coding it cannot decode, stacked codings, or a corrupt stream are refused', async () => {
  for (const coding of ['zstd', 'gzip, br', 'compress']) {
    const transport = scriptedTransport(() => css('x', { 'content-encoding': coding }));
    assert.equal((await failure(fetchPublic('https://shop.example.com/a.css', 'css', { budget: budget(), transport }))).code, 'wrong_type', coding);
  }
  const corrupt = scriptedTransport(() => css('definitely not gzip', { 'content-encoding': 'gzip' }));
  assert.equal((await failure(fetchPublic('https://shop.example.com/a.css', 'css', { budget: budget(), transport: corrupt }))).code, 'network');
});

test('headers that never arrive time out, and the timeout is not retried', async () => {
  const transport = scriptedTransport(() => never());
  const started = Date.now();
  const error = await failure(fetchPublic('https://slow.example.com/', 'html', { budget: budget(), transport, timeouts: { connectMs: 30 } }));
  assert.equal(error.code, 'timeout');
  assert.ok(Date.now() - started < 2_000);
  assert.equal(transport.requests.length, 1);
});

test('a body that stalls part-way times out and is torn down', async () => {
  const stalled = new Readable({ read() { /* the site stops sending */ } });
  stalled.push('<html><body>');
  const stalling = scriptedTransport((): FakeReply => ({ ...page(''), body: stalled }));
  const error = await failure(fetchPublic('https://slow.example.com/', 'html', { budget: budget(), transport: stalling, timeouts: { totalMs: 50 } }));
  assert.equal(error.code, 'timeout');
  assert.equal(stalled.destroyed, true);
});

test('no request outlives the crawl deadline, whatever the per-request timeout', async () => {
  const transport = scriptedTransport(() => never());
  const started = Date.now();
  const error = await failure(fetchPublic('https://slow.example.com/', 'html', { budget: budget({ deadlineMs: 40 }), transport }));
  assert.equal(error.code, 'timeout');
  assert.ok(Date.now() - started < 2_000);
});

test('a transient failure is retried once; a client error is not', async () => {
  const recovering = scriptedTransport((_request, index) => (index === 0 ? { status: 503 } : page('back')));
  assert.equal((await fetchPublic('https://shop.example.com/', 'html', { budget: budget(), transport: recovering })).body.toString('utf8'), 'back');
  assert.equal(recovering.requests.length, 2);

  const down = scriptedTransport((): FakeReply => ({ status: 503 }));
  const error = await failure(fetchPublic('https://shop.example.com/', 'html', { budget: budget(), transport: down }));
  assert.equal(error.code, 'http_status');
  assert.equal(error.status, 503);
  assert.equal(down.requests.length, 2);

  const unreachable = scriptedTransport(() => { throw new Error('socket hang up'); });
  assert.equal((await failure(fetchPublic('https://shop.example.com/', 'html', { budget: budget(), transport: unreachable }))).code, 'network');
  assert.equal(unreachable.requests.length, 2);

  const gone = scriptedTransport((): FakeReply => ({ status: 410 }));
  assert.equal((await failure(fetchPublic('https://shop.example.com/', 'html', { budget: budget(), transport: gone }))).code, 'http_status');
  assert.equal(gone.requests.length, 1);
});

test('redirect hops draw on the request budget', async () => {
  const transport = scriptedTransport((_request, index) => redirect(`/hop-${index + 1}`));
  const error = await failure(fetchPublic('https://shop.example.com/', 'html', { budget: budget({ maxRequests: 2 }), transport }));
  assert.equal(error.code, 'budget_exhausted');
  assert.equal(transport.requests.length, 2);
});

test('bytes are charged across every fetch for the site', async () => {
  const site = budget({ maxBytes: 10 });
  const transport = scriptedTransport(() => page('12345678'));
  await fetchPublic('https://shop.example.com/', 'html', { budget: site, transport });
  assert.equal((await failure(fetchPublic('https://shop.example.com/about', 'html', { budget: site, transport }))).code, 'budget_exhausted');
});

test('a spent deadline refuses the next request before it is sent', async () => {
  let now = 0;
  const site = new CrawlBudget({ maxRequests: 10, maxBytes: 1_000, deadlineMs: 1_000 }, () => now);
  const transport = scriptedTransport(() => page('late'));
  now = 1_000;
  assert.equal((await failure(fetchPublic('https://shop.example.com/', 'html', { budget: site, transport }))).code, 'budget_exhausted');
  assert.equal(transport.requests.length, 0);
});
