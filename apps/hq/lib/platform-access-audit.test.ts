import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionInfo } from './demo-data';
import {
  recordPlatformAccess,
  type PlatformAccessAuditDependencies,
} from './platform-access-audit';

const HOME = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const LOCATION = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const CORRELATION = '55555555-5555-4555-8555-555555555555';

const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  userId: USER,
  email: 'operator@example.test',
  role: 'platform_admin',
  brandId: HOME,
  brandName: 'Home tenant',
  ...overrides,
});

function dependencies(error: { code: string } | null = null) {
  const calls: { event?: Record<string, unknown>; failures: Record<string, unknown>[] } = {
    failures: [],
  };
  const deps: PlatformAccessAuditDependencies = {
    configured: () => true,
    correlationId: () => CORRELATION,
    environment: () => ({ url: 'https://project.supabase.co', serviceRoleKey: 'service' }),
    logFailure: (details) => calls.failures.push(details),
    write: async (_environment, written) => {
      calls.event = written;
      return error
        ? { ok: false, errorCode: error.code, reason: 'rpc_failed' }
        : { ok: true };
    },
  };
  return { calls, deps };
}

const target = {
  action: 'workspace.location.select' as const,
  brandId: FOREIGN,
  locationId: LOCATION,
};

describe('recordPlatformAccess', () => {
  it('keeps demo and home-tenant selections off the service-role path', async () => {
    const first = dependencies();
    first.deps.configured = () => false;
    assert.equal(await recordPlatformAccess(session(), target, first.deps), true);
    assert.equal(first.calls.event, undefined);

    const second = dependencies();
    assert.equal(await recordPlatformAccess(session(), { ...target, brandId: HOME }, second.deps), true);
    assert.equal(second.calls.event, undefined);
  });

  it('fails closed when a cross-tenant actor is not a verified platform admin', async () => {
    for (const actor of [session({ role: 'brand_owner' }), session({ userId: null })]) {
      const { calls, deps } = dependencies();
      assert.equal(await recordPlatformAccess(actor, target, deps), false);
      assert.equal(calls.event, undefined);
      assert.deepEqual(calls.failures[0], {
        action: 'workspace.location.select',
        reason: 'invalid_actor',
      });
    }
  });

  it('writes the complete bounded audit event before allowing the scope change', async () => {
    const { calls, deps } = dependencies();
    assert.equal(await recordPlatformAccess(session(), target, deps), true);
    assert.deepEqual(calls.event, {
      action: 'workspace.location.select',
      actorId: USER,
      brandId: FOREIGN,
      correlationId: CORRELATION,
      locationId: LOCATION,
      metadata: { source: 'workspace_switcher', surface: 'hq' },
    });
    assert.deepEqual(calls.failures, []);
  });

  it('can require an audited privileged write inside the home tenant', async () => {
    const { calls, deps } = dependencies();
    assert.equal(await recordPlatformAccess(session(), {
      ...target, action: 'fees.location.update', brandId: HOME, required: true,
    }, deps), true);
    assert.equal(calls.event?.action, 'fees.location.update');
    assert.deepEqual(calls.event?.metadata, { source: 'operate_as_brand', surface: 'hq' });
  });

  it('fails closed and logs only a safe error code when the audit RPC refuses', async () => {
    const { calls, deps } = dependencies({ code: '42501' });
    assert.equal(await recordPlatformAccess(session(), target, deps), false);
    assert.deepEqual(calls.failures, [{
      action: 'workspace.location.select',
      errorCode: '42501',
      reason: 'rpc_failed',
    }]);
  });

  it('fails closed when the service client or RPC is unavailable', async () => {
    const missing = dependencies();
    missing.deps.environment = () => null;
    assert.equal(await recordPlatformAccess(session(), target, missing.deps), false);

    const throwing = dependencies();
    throwing.deps.write = async () => { throw new Error('network detail'); };
    assert.equal(await recordPlatformAccess(session(), target, throwing.deps), false);
    assert.equal(throwing.calls.failures[0]?.reason, 'rpc_unavailable');
  });
});
