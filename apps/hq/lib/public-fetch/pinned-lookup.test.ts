import assert from 'node:assert/strict';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import test from 'node:test';

import { PublicFetchError } from './errors';
import { failure, tableResolver } from './fakes.test-support';
import { createPinnedLookup, resolvePublicAddresses } from './pinned-lookup';

type LookupAnswer = {
  readonly error: NodeJS.ErrnoException | null;
  readonly address: string | LookupAddress[];
  readonly family: number | undefined;
};

function lookupOnce(lookup: LookupFunction, hostname: string, options: LookupOptions): Promise<LookupAnswer> {
  return new Promise((resolve) => {
    lookup(hostname, options, (error, address, family) => resolve({ error, address, family }));
  });
}

const resolver = tableResolver({
  'shop.example.com': [['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']],
  'mixed.example.com': [['93.184.216.34', '10.0.0.7']],
  'mixed-first.example.com': [['127.0.0.1', '93.184.216.34']],
  'nat64.example.com': [['64:ff9b::a00:1']],
  'empty.example.com': [[]],
  'v4-private-v6-public.example.com': [['10.0.0.7', '2606:2800:220:1:248:1893:25c8:1946']],
});

test('a name with any private answer is refused, wherever that answer sits in the list', async () => {
  for (const name of ['mixed.example.com', 'mixed-first.example.com', 'nat64.example.com']) {
    assert.equal((await failure(resolvePublicAddresses(name, resolver))).code, 'not_public', name);
  }
});

test('an empty answer or a failed resolution is a network error, not a pass', async () => {
  assert.equal((await failure(resolvePublicAddresses('empty.example.com', resolver))).code, 'network');
  assert.equal((await failure(resolvePublicAddresses('missing.example.com', resolver))).code, 'network');
});

test('an address literal is judged without asking the resolver', async () => {
  const quiet = tableResolver({});
  assert.deepEqual(await resolvePublicAddresses('[2606:4700:4700::1111]', quiet), [
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  assert.equal((await failure(resolvePublicAddresses('127.0.0.1', quiet))).code, 'not_public');
  assert.deepEqual(quiet.asked, []);
});

test('when Node asks for every address it gets exactly the checked ones', async () => {
  const answer = await lookupOnce(createPinnedLookup(resolver), 'shop.example.com', { all: true });
  assert.equal(answer.error, null);
  assert.deepEqual(answer.address, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]);
});

test('when Node asks for one address it gets the first checked one and its family', async () => {
  const answer = await lookupOnce(createPinnedLookup(resolver), 'shop.example.com', {});
  assert.equal(answer.error, null);
  assert.equal(answer.address, '93.184.216.34');
  assert.equal(answer.family, 4);
});

test('a family filter narrows only after the whole answer has passed', async () => {
  const lookup = createPinnedLookup(resolver);
  const six = await lookupOnce(lookup, 'shop.example.com', { family: 6 });
  assert.equal(six.address, '2606:2800:220:1:248:1893:25c8:1946');
  assert.equal(six.family, 6);
  // Asking only for IPv6 must not hide the private IPv4 answer beside it.
  const hidden = await lookupOnce(lookup, 'v4-private-v6-public.example.com', { family: 'IPv6', all: true });
  assert.ok(hidden.error instanceof PublicFetchError);
  assert.equal(hidden.error.code, 'not_public');
});

test('refusals reach the socket as typed errors', async () => {
  const lookup = createPinnedLookup(resolver);
  const refused = await lookupOnce(lookup, 'mixed.example.com', { all: true });
  assert.ok(refused.error instanceof PublicFetchError);
  assert.equal(refused.error.code, 'not_public');
  const unresolved = await lookupOnce(lookup, 'missing.example.com', {});
  assert.ok(unresolved.error instanceof PublicFetchError);
  assert.equal(unresolved.error.code, 'network');
  const noSuchFamily = await lookupOnce(createPinnedLookup(tableResolver({ 'v4.example.com': [['93.184.216.34']] })), 'v4.example.com', { family: 6 });
  assert.ok(noSuchFamily.error instanceof PublicFetchError);
  assert.equal(noSuchFamily.error.code, 'network');
});
