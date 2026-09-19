import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicFetchError } from './public-fetch';
import { redirect, scriptedTransport } from './public-fetch/fakes.test-support';
import { isPublicIpAddress, verifyPublicResource } from './public-resource-verifier';

const GUIDE = 'https://training.cdnhost.example/espresso-guide.pdf';
const NOT_PUBLIC = 'resource hostname resolves outside the public internet';

test('resource verifier rejects loopback, private, link-local, and mapped addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

test('resource verifier accepts routable IPv4 and IPv6 addresses', () => {
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('resource verifier shares the crawler policy, so the old IPv6 and TEST-NET gaps are closed here too', () => {
  for (const address of ['ff02::1', '64:ff9b::a00:1', '2002:c0a8:101::1', '2001::1', '2001:db8::1', '198.51.100.1', '203.0.113.1', '0:0:0:0:0:ffff:7f00:1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

test('a link that answers is verified with one ranged request, not a download', async () => {
  const transport = scriptedTransport(() => ({ status: 206, headers: { 'content-type': 'application/pdf' }, body: '%' }));
  await verifyPublicResource(GUIDE, transport);
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0]?.headers.range, 'bytes=0-0');
  assert.match(transport.requests[0]?.headers['user-agent'] ?? '', /OrderingLinkCheck/);
});

test('every redirect is checked again before it is followed', async () => {
  for (const [location, message] of [
    ['https://127.0.0.1/admin', NOT_PUBLIC],
    ['https://metadata.internal/latest', NOT_PUBLIC],
    ['http://training.cdnhost.example/guide.pdf', 'resource URL must use standard public HTTPS'],
    ['https://training.cdnhost.example:8443/guide.pdf', 'resource URL must use standard public HTTPS'],
  ] as const) {
    const transport = scriptedTransport(() => redirect(location));
    await assert.rejects(verifyPublicResource(GUIDE, transport), { message }, location);
    assert.equal(transport.requests.length, 1, location);
  }
});

test('a name that resolves to a private address is refused, and not asked about twice', async () => {
  // The pinned transport refuses at connect time; this stands in for it.
  const transport = scriptedTransport(() => {
    throw new PublicFetchError('not_public');
  });
  await assert.rejects(verifyPublicResource(GUIDE, transport), { message: NOT_PUBLIC });
  assert.equal(transport.requests.length, 1);
});

test('a busy server is asked twice, then reported by its status alone', async () => {
  const busy = scriptedTransport(() => ({ status: 503, body: 'upstream internal-host-7 is down' }));
  await assert.rejects(verifyPublicResource(GUIDE, busy), { message: 'resource returned 503' });
  assert.equal(busy.requests.length, 2);
  const recovered = scriptedTransport((_, index) => (index === 0 ? { status: 429 } : { status: 200 }));
  await verifyPublicResource(GUIDE, recovered);
  assert.equal(recovered.requests.length, 2);
});

test('a link that fails or loops is reported in a fixed sentence', async () => {
  await assert.rejects(verifyPublicResource(GUIDE, scriptedTransport(() => ({ status: 404 }))), { message: 'resource returned 404' });
  await assert.rejects(verifyPublicResource(GUIDE, scriptedTransport(() => ({ status: 302 }))), { message: 'resource redirect has no location' });
  const loop = scriptedTransport((request) => redirect(`${request.url.href}x`));
  await assert.rejects(verifyPublicResource(GUIDE, loop), { message: 'resource has too many redirects' });
  assert.equal(loop.requests.length, 4);
  const offline = scriptedTransport(() => {
    throw new PublicFetchError('network');
  });
  await assert.rejects(verifyPublicResource(GUIDE, offline), { message: 'resource request failed' });
  assert.equal(offline.requests.length, 2);
});

test('an address that is not standard public HTTPS is refused before any request', async () => {
  const transport = scriptedTransport(() => ({ status: 200 }));
  for (const value of ['http://training.cdnhost.example/', 'https://someone@training.cdnhost.example/', 'https://10.0.0.8/', 'https://localhost/', 'not a url']) {
    await assert.rejects(verifyPublicResource(value, transport), Error, value);
  }
  assert.equal(transport.requests.length, 0);
});
