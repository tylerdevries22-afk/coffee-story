import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installationIdFromDeviceToken, recordDeviceWallPresence } from './device-wall-presence';

const DEVICE = '123e4567-e89b-42d3-a456-426614174000';
const LOCATION = '123e4567-e89b-42d3-a456-426614174001';
const token = (payload: object) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('display device wall presence', () => {
  it('reads only a well-formed installation id from the device JWT payload', () => {
    assert.equal(installationIdFromDeviceToken(token({ device_id: DEVICE })), DEVICE);
    assert.equal(installationIdFromDeviceToken(token({ device_id: 'not-a-uuid' })), null);
    assert.equal(installationIdFromDeviceToken('broken'), null);
  });

  it('sends the credential only to the configured HQ heartbeat endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    };
    assert.equal(await recordDeviceWallPresence(LOCATION, {
      fetcher, hqOrigin: 'https://hq.example', token: token({ device_id: DEVICE }),
    }), true);
    assert.equal(calls[0]?.url, 'https://hq.example/api/device-wall/heartbeat');
    assert.equal(calls[0]?.init?.headers instanceof Headers, false);
    assert.match(String((calls[0]?.init?.headers as Record<string, string>).authorization), /^Bearer /);
  });

  it('fails closed before a request for malformed scope or identity', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls += 1; return new Response(); };
    assert.equal(await recordDeviceWallPresence('wrong', { fetcher, hqOrigin: 'https://hq.example', token: token({ device_id: DEVICE }) }), false);
    assert.equal(await recordDeviceWallPresence(LOCATION, { fetcher, hqOrigin: 'https://hq.example', token: token({}) }), false);
    assert.equal(calls, 0);
  });
});
