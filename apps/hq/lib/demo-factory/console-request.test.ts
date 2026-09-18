import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { SessionInfo } from '../demo-data';
import { resetRateLimits } from '../rate-limit';
import { DEMO_CONSOLE_LIMITS, demoConsoleContext, type DemoConsoleDeps } from './console-request';

const HQ = 'https://hq.example.test';
const ADMIN: SessionInfo = {
  userId: 'admin-1', email: 'admin@example.test', role: 'platform_admin', brandId: 'b-1', brandName: 'Platform',
};

function deps(session: SessionInfo | null = ADMIN): DemoConsoleDeps & { lookups: () => number } {
  let lookups = 0;
  return { session: async () => { lookups += 1; return session; }, lookups: () => lookups };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request(`${HQ}/api/demos/outreach`, {
    method: 'POST',
    headers: { origin: HQ, 'sec-fetch-site': 'same-origin', 'x-real-ip': '203.0.113.7', ...headers },
    body: new URLSearchParams({ day: '2026-09-18' }),
  });
}

async function status(result: Promise<unknown>): Promise<number | 'admitted'> {
  const value = await result;
  return value instanceof Response ? value.status : 'admitted';
}

beforeEach(() => resetRateLimits());

describe('demoConsoleContext', () => {
  it('admits a platform admin posting from the console, and names them', async () => {
    const context = await demoConsoleContext(request(), 'outreach', deps());
    assert.ok(!(context instanceof Response));
    assert.equal(context.actor, 'admin-1');
    assert.ok(context.requestId.length > 0);
  });

  it('refuses another origin before it looks at the session', async () => {
    for (const headers of [{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'same-site' }]) {
      const fixture = deps();
      assert.equal(await status(demoConsoleContext(request(headers), 'outreach', fixture)), 403, JSON.stringify(headers));
      assert.equal(fixture.lookups(), 0);
    }
    const noOrigin = new Request(`${HQ}/api/demos/outreach`, { method: 'POST', headers: { 'x-real-ip': '203.0.113.7' } });
    assert.equal(await status(demoConsoleContext(noOrigin, 'outreach', deps())), 403);
  });

  it('refuses a stranger and anyone short of a platform admin', async () => {
    assert.equal(await status(demoConsoleContext(request(), 'outreach', deps(null))), 401);
    for (const role of ['brand_owner', 'location_manager', 'staff'] as const) {
      assert.equal(await status(demoConsoleContext(request(), 'outreach', deps({ ...ADMIN, role }))), 403, role);
    }
  });

  it('throttles an address before it costs a session lookup', async () => {
    for (let index = 0; index < DEMO_CONSOLE_LIMITS.outreach.perAddress; index += 1) {
      await demoConsoleContext(request({ 'x-real-ip': '198.51.100.9' }), 'outreach', deps(null));
    }
    const fixture = deps();
    assert.equal(await status(demoConsoleContext(request({ 'x-real-ip': '198.51.100.9' }), 'outreach', fixture)), 429);
    assert.equal(fixture.lookups(), 0);
  });

  it('throttles one admin across addresses', async () => {
    for (let index = 0; index < DEMO_CONSOLE_LIMITS.outreach.perAdmin; index += 1) {
      assert.equal(await status(demoConsoleContext(request({ 'x-real-ip': `192.0.2.${index}` }), 'outreach', deps())), 'admitted');
    }
    assert.equal(await status(demoConsoleContext(request({ 'x-real-ip': '192.0.2.250' }), 'outreach', deps())), 429);
  });
});
