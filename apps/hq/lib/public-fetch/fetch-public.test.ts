import assert from 'node:assert/strict';
import test from 'node:test';

import { CrawlBudget } from './budget';
import {
  emulatedHttps, failure, page, redirect, scriptedTransport, tableResolver, type FakeReply,
} from './fakes.test-support';
import { fetchPublic, MAX_REDIRECTS } from './fetch-public';
import { createHttpsTransport } from './https-transport';
import { PUBLIC_FETCH_USER_AGENT } from './user-agent';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

test('a page comes back with its type, charset and final address, asked for honestly', async () => {
  const transport = scriptedTransport(() => page('<h1>Maple Row Bakery</h1>'));
  const result = await fetchPublic('https://bakery.example.com/#top', 'html', { budget: new CrawlBudget(), transport });
  assert.equal(result.body.toString('utf8'), '<h1>Maple Row Bakery</h1>');
  assert.equal(result.mediaType, 'text/html');
  assert.equal(result.charset, 'utf-8');
  assert.equal(result.url.href, 'https://bakery.example.com/');
  assert.equal(result.redirects, 0);
  const [request] = transport.requests;
  assert.ok(request);
  assert.equal(request.headers['user-agent'], PUBLIC_FETCH_USER_AGENT);
  assert.equal(request.headers['accept-encoding'], 'identity');
  assert.match(request.headers.accept ?? '', /^text\/html/);
});

test('a relative redirect is followed, and the result says where the body came from', async () => {
  const transport = scriptedTransport((_request, index) => (index === 0 ? redirect('/menu', 301) : page('menu')));
  const result = await fetchPublic('https://bakery.example.com/', 'html', { budget: new CrawlBudget(), transport });
  assert.equal(result.url.href, 'https://bakery.example.com/menu');
  assert.equal(result.redirects, 1);
  assert.deepEqual(transport.requests.map(({ url }) => url.href), [
    'https://bakery.example.com/', 'https://bakery.example.com/menu',
  ]);
});

test('a redirect inward is refused before anything is requested from it', async () => {
  const cases: [string, string][] = [
    ['https://169.254.169.254/latest/meta-data/', 'not_public'],
    ['https://[::ffff:127.0.0.1]/admin', 'not_public'],
    ['https://localhost/', 'not_public'],
    ['http://bakery.example.com/', 'invalid_url'],
    ['https://bakery.example.com:8443/', 'invalid_url'],
    ['https://admin:admin@bakery.example.com/', 'invalid_url'],
  ];
  for (const [location, code] of cases) {
    const transport = scriptedTransport(() => redirect(location));
    const error = await failure(fetchPublic('https://bakery.example.com/', 'html', { budget: new CrawlBudget(), transport }));
    assert.equal(error.code, code, location);
    assert.equal(transport.requests.length, 1, location);
  }
});

test('a fourth redirect is refused', async () => {
  const transport = scriptedTransport((_request, index) => redirect(`/hop-${index + 1}`));
  const error = await failure(fetchPublic('https://bakery.example.com/', 'html', { budget: new CrawlBudget(), transport }));
  assert.equal(error.code, 'redirect_limit');
  assert.equal(transport.requests.length, MAX_REDIRECTS + 1);
});

test('a redirect with nowhere to go is an error status', async () => {
  const transport = scriptedTransport((): FakeReply => ({ status: 302 }));
  const error = await failure(fetchPublic('https://bakery.example.com/', 'html', { budget: new CrawlBudget(), transport }));
  assert.equal(error.code, 'http_status');
  assert.equal(error.status, 302);
});

test('a redirect to a name that resolves privately is refused at connect time', async () => {
  const send = emulatedHttps({
    'bakery.example.com': () => redirect('https://assets.example.net/logo.png'),
    'assets.example.net': () => ({ status: 200, headers: { 'content-type': 'image/jpeg' }, body: JPEG }),
  });
  const transport = createHttpsTransport({
    request: send,
    resolve: tableResolver({
      'bakery.example.com': [['93.184.216.34']],
      'assets.example.net': [['10.20.30.40']],
    }),
  });
  const error = await failure(fetchPublic('https://bakery.example.com/', 'image', { budget: new CrawlBudget(), transport }));
  assert.equal(error.code, 'not_public');
  assert.deepEqual(send.connectedTo, ['93.184.216.34']);
});

test('a name rebound to a private address between two fetches is caught on the second connect', async () => {
  const send = emulatedHttps({ 'rebind.example.com': () => page('first answer') });
  const resolve = tableResolver({ 'rebind.example.com': [['93.184.216.34'], ['127.0.0.1']] });
  const transport = createHttpsTransport({ request: send, resolve });
  const budget = new CrawlBudget();
  const first = await fetchPublic('https://rebind.example.com/', 'html', { budget, transport });
  assert.equal(first.body.toString('utf8'), 'first answer');
  const error = await failure(fetchPublic('https://rebind.example.com/about', 'html', { budget, transport }));
  assert.equal(error.code, 'not_public');
  assert.deepEqual(send.connectedTo, ['93.184.216.34']);
});

test('one private address among public ones taints the whole name', async () => {
  const send = emulatedHttps({ 'round-robin.example.com': () => page('never') });
  const transport = createHttpsTransport({
    request: send,
    resolve: tableResolver({ 'round-robin.example.com': [['93.184.216.34', '2606:2800:220:1::1', '192.168.1.20']] }),
  });
  const error = await failure(fetchPublic('https://round-robin.example.com/', 'html', { budget: new CrawlBudget(), transport }));
  assert.equal(error.code, 'not_public');
  assert.deepEqual(send.connectedTo, []);
});

test('a private address literal is refused without a request', async () => {
  const transport = scriptedTransport(() => page('never'));
  for (const target of ['https://10.0.0.1/', 'https://[fd00::1]/', 'https://[64:ff9b::a00:1]/']) {
    const error = await failure(fetchPublic(target, 'html', { budget: new CrawlBudget(), transport }));
    assert.equal(error.code, 'not_public', target);
  }
  assert.equal(transport.requests.length, 0);
});

test('an error status carries its number and nothing the site said', async () => {
  const transport = scriptedTransport((): FakeReply => ({
    status: 404, headers: { 'content-type': 'text/html', 'x-internal': 'do-not-echo' }, body: 'stack trace here',
  }));
  const error = await failure(fetchPublic('https://bakery.example.com/missing', 'html', { budget: new CrawlBudget(), transport }));
  assert.equal(error.code, 'http_status');
  assert.equal(error.status, 404);
  assert.equal(error.message, 'The site answered with HTTP 404.');
  assert.equal(transport.requests.length, 1);
});
