import assert from 'node:assert/strict';
import test from 'node:test';

import { recordHqScreen } from './hq-telemetry';

const input = {
  accessToken: 'server-cookie-access-token',
  behavioralConsent: true,
  brandId: 'e627d6c2-6cb9-4368-8543-abd02a5afb7c',
  endpointOrigin: 'https://hq.example.com',
  pathname: '/analytics/apps',
};

test('recordHqScreen sends allowlisted events with a server-held bearer', async () => {
  let request: RequestInit | undefined;
  const result = await recordHqScreen(input, {
    now: new Date('2026-08-27T18:00:00.000Z'),
    createId: () => '30000000-0000-4000-8000-000000000003',
    fetcher: async (_url, init) => {
      request = init;
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(result?.accepted, 2);
  assert.equal(new Headers(request?.headers).get('authorization'), 'Bearer server-cookie-access-token');
  const body = JSON.parse(String(request?.body)) as { events: { properties: { screenKey?: string; entryPoint?: string } }[] };
  assert.deepEqual(body.events.map((event) => event.properties), [
    { entryPoint: 'analytics_apps' },
    { screenKey: 'analytics_apps' },
  ]);
});

test('recordHqScreen does not collect behavioral events without consent', async () => {
  assert.equal(await recordHqScreen({ ...input, behavioralConsent: false }), null);
});
