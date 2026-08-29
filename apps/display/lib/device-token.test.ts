import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  deviceToken, deviceTokenConfigured, resetDeviceTokenCache,
  type DeviceTokenEnvironment,
} from './device-token';

const HQ = 'https://hq.example.test';
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function environment(overrides: Partial<DeviceTokenEnvironment> = {}): DeviceTokenEnvironment {
  return {
    staticToken: undefined, refreshSecret: undefined, hqOrigin: undefined, ...overrides,
  };
}

/** Records every call, so a test can assert HQ was asked once and not four times. */
function recorder(handler: (call: number) => Response | Promise<Response>) {
  const calls: RequestInit[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return handler(calls.length);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function minted(token: string, expiresInMs: number): Response {
  return new Response(
    JSON.stringify({ token, expiresAt: new Date(NOW + expiresInMs).toISOString() }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

beforeEach(() => { resetDeviceTokenCache(); });

describe('deviceToken', () => {
  it('uses the static token when no refresh secret is configured', async () => {
    const { calls, fetcher } = recorder(() => minted('unexpected', MINUTE));
    const token = await deviceToken({
      environment: environment({ staticToken: 'static.jwt' }),
      now: () => NOW,
      fetcher,
    });
    assert.equal(token, 'static.jwt');
    // The two credentials roll out in either order, so a deployment with only
    // the old one must not reach for an endpoint it was never told about.
    assert.equal(calls.length, 0);
  });

  it('exchanges the refresh secret for a token and caches it', async () => {
    const { calls, fetcher } = recorder(() => minted('fresh.jwt', 12 * 60 * MINUTE));
    const env = environment({ refreshSecret: 'secret-value', hqOrigin: HQ });

    assert.equal(await deviceToken({ environment: env, now: () => NOW, fetcher }), 'fresh.jwt');
    assert.equal(await deviceToken({ environment: env, now: () => NOW + MINUTE, fetcher }),
      'fresh.jwt');

    assert.equal(calls.length, 1, 'the cached token should not be re-minted every render');
    assert.deepEqual(JSON.parse(String(calls[0]?.body)), { secret: 'secret-value' });
  });

  it('refreshes before expiry rather than at it', async () => {
    const { calls, fetcher } = recorder((call) => minted(`jwt-${call}`, 30 * MINUTE));
    const env = environment({ refreshSecret: 'secret-value', hqOrigin: HQ });

    assert.equal(await deviceToken({ environment: env, now: () => NOW, fetcher }), 'jwt-1');
    // Inside the five-minute skew: still valid, but a slow exchange started now
    // would land after it died, which is the whole failure this avoids.
    const token = await deviceToken({
      environment: env, now: () => NOW + 27 * MINUTE, fetcher,
    });
    assert.equal(token, 'jwt-2');
    assert.equal(calls.length, 2);
  });

  it('serves one exchange to the callers that all wake at boot', async () => {
    let release = (_: Response) => {};
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const { calls, fetcher } = recorder(() => pending);
    const env = environment({ refreshSecret: 'secret-value', hqOrigin: HQ });

    // The board render, the SSE route and the telemetry write, concurrently.
    const all = Promise.all([
      deviceToken({ environment: env, now: () => NOW, fetcher }),
      deviceToken({ environment: env, now: () => NOW, fetcher }),
      deviceToken({ environment: env, now: () => NOW, fetcher }),
    ]);
    release(minted('shared.jwt', 12 * 60 * MINUTE));

    assert.deepEqual(await all, ['shared.jwt', 'shared.jwt', 'shared.jwt']);
    assert.equal(calls.length, 1, 'three consumers should not mint three tokens');
  });

  it('does not retry a secret HQ rejected, and backs off before asking again', async () => {
    const { calls, fetcher } = recorder(() => new Response('{}', { status: 401 }));
    const env = environment({
      staticToken: 'static.jwt', refreshSecret: 'revoked', hqOrigin: HQ,
    });

    assert.equal(await deviceToken({ environment: env, now: () => NOW, fetcher }), 'static.jwt');
    assert.equal(calls.length, 1, 'a rejected secret is rejected again eight seconds later');

    // A revoked screen stays plugged in and keeps rendering. Without the
    // backoff it would POST to HQ on every one of those renders.
    await deviceToken({ environment: env, now: () => NOW + 1_000, fetcher });
    await deviceToken({ environment: env, now: () => NOW + 20_000, fetcher });
    assert.equal(calls.length, 1);

    assert.equal(await deviceToken({ environment: env, now: () => NOW + 31_000, fetcher }),
      'static.jwt');
    assert.equal(calls.length, 2, 'the backoff should expire, not become permanent');
  });

  it('retries a server fault, then falls back rather than going dark', async () => {
    const { calls, fetcher } = recorder(() => new Response('', { status: 503 }));
    const token = await deviceToken({
      environment: environment({
        staticToken: 'static.jwt', refreshSecret: 'secret-value', hqOrigin: HQ,
      }),
      now: () => NOW,
      fetcher,
    });
    assert.equal(token, 'static.jwt');
    assert.equal(calls.length, 3, 'a transient fault deserves the retries a rejection does not');
  });

  it('keeps serving a stale token while HQ is unreachable', async () => {
    const { fetcher } = recorder((call) => (call === 1
      ? minted('good.jwt', 30 * MINUTE)
      : new Response('{}', { status: 401 })));
    const env = environment({ refreshSecret: 'secret-value', hqOrigin: HQ });

    assert.equal(await deviceToken({ environment: env, now: () => NOW, fetcher }), 'good.jwt');
    // Past the skew, before expiry: the refresh fails, but the token in hand is
    // still accepted by the database, and a wall board is not improved by
    // discarding a credential that still works.
    const token = await deviceToken({
      environment: env, now: () => NOW + 27 * MINUTE, fetcher,
    });
    assert.equal(token, 'good.jwt');
  });

  it('does not mistake a malformed HQ origin for a missing credential', async () => {
    const { calls, fetcher } = recorder(() => minted('unexpected', MINUTE));
    const token = await deviceToken({
      environment: environment({
        staticToken: 'static.jwt', refreshSecret: 'secret-value', hqOrigin: 'not a url',
      }),
      now: () => NOW,
      fetcher,
    });
    assert.equal(token, 'static.jwt');
    assert.equal(calls.length, 0);
  });

  it('reports no credential rather than an empty string when nothing is set', async () => {
    const { fetcher } = recorder(() => minted('unexpected', MINUTE));
    assert.equal(
      await deviceToken({ environment: environment(), now: () => NOW, fetcher }),
      null,
    );
  });
});

describe('deviceTokenConfigured', () => {
  it('accepts either credential and refuses half of the refresh pair', () => {
    assert.equal(deviceTokenConfigured(environment({ staticToken: 'static.jwt' })), true);
    assert.equal(
      deviceTokenConfigured(environment({ refreshSecret: 'secret-value', hqOrigin: HQ })),
      true,
    );
    // A secret with nowhere to exchange it cannot produce a token, and calling
    // that "configured" renders a live-looking board with no rows.
    assert.equal(deviceTokenConfigured(environment({ refreshSecret: 'secret-value' })), false);
    assert.equal(deviceTokenConfigured(environment({ hqOrigin: HQ })), false);
    assert.equal(deviceTokenConfigured(environment()), false);
  });
});
