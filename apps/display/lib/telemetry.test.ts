import assert from 'node:assert/strict';
import test from 'node:test';

import { recordDisplayScreen } from './telemetry';

const BRAND_ID = 'e627d6c2-6cb9-4368-8543-abd02a5afb7c';
const LOCATION_ID = '10000000-0000-4000-8000-000000000001';
const payload = Buffer.from(JSON.stringify({ app_metadata: { brand_id: BRAND_ID } })).toString('base64url');
const token = `header.${payload}.signature`;

test('recordDisplayScreen sends tenant-scoped display events with the server-held token', async () => {
  let request: RequestInit | undefined;
  const result = await recordDisplayScreen(LOCATION_ID, {
    environment: { hqOrigin: 'https://hq.example.com', deviceToken: token, appVersion: 'build-1' },
    createId: () => '20000000-0000-4000-8000-000000000002',
    fetcher: async (_input, init) => {
      request = init;
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(result?.accepted, 2);
  assert.equal(new Headers(request?.headers).get('authorization'), `Bearer ${token}`);
  const body = JSON.parse(String(request?.body)) as { events: { brandId: string; locationId: string; surface: string }[] };
  assert.equal(body.events.length, 2);
  assert.deepEqual(body.events.map(({ brandId, locationId, surface }) => ({ brandId, locationId, surface })), [
    { brandId: BRAND_ID, locationId: LOCATION_ID, surface: 'display' },
    { brandId: BRAND_ID, locationId: LOCATION_ID, surface: 'display' },
  ]);
});

test('recordDisplayScreen is a no-op for an unpaired or malformed deployment', async () => {
  assert.equal(await recordDisplayScreen('not-a-location', {
    environment: { hqOrigin: 'https://hq.example.com', deviceToken: token, appVersion: 'build-1' },
  }), null);
  assert.equal(await recordDisplayScreen(LOCATION_ID, {
    environment: { hqOrigin: undefined, deviceToken: undefined, appVersion: 'build-1' },
  }), null);
});
