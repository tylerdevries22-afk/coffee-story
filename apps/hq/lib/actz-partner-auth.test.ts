import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { mintActzHandoffToken } from './actz-handoff';
import {
  actzIntegrationKeyAccepted,
  authenticateActzPartner,
} from './actz-partner-auth';

describe('actz partner auth', () => {
  const prev = {
    integration: process.env.ACTZ_INTEGRATION_SECRET,
    handoff: process.env.APP_FACTORY_HANDOFF_SECRET,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    elevate: process.env.ELEVATE_INTEGRATION_SECRET,
    webSocket: globalThis.WebSocket,
  };

  beforeEach(() => {
    process.env.ACTZ_INTEGRATION_SECRET = 'actz-integration-secret';
    process.env.APP_FACTORY_HANDOFF_SECRET = 'actz-handoff-secret';
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
    // Supabase-js constructs a Realtime client even when unused; Node <22
    // has no global WebSocket. Stub one so unit tests stay offline.
    if (typeof globalThis.WebSocket === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).WebSocket = class {
        close(): void {}
      };
    }
  });

  afterEach(() => {
    process.env.ACTZ_INTEGRATION_SECRET = prev.integration;
    process.env.APP_FACTORY_HANDOFF_SECRET = prev.handoff;
    process.env.SUPABASE_URL = prev.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prev.anon;
    process.env.ELEVATE_INTEGRATION_SECRET = prev.elevate;
    if (prev.webSocket) {
      globalThis.WebSocket = prev.webSocket;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).WebSocket;
    }
  });

  it('accepts the integration key and fails closed when unset', () => {
    const ok = new Request('http://localhost', {
      headers: { 'x-integration-key': 'actz-integration-secret' },
    });
    assert.equal(actzIntegrationKeyAccepted(ok), true);
    delete process.env.ACTZ_INTEGRATION_SECRET;
    assert.equal(actzIntegrationKeyAccepted(ok), false);
  });

  it('does not accept elevate secrets', () => {
    process.env.ELEVATE_INTEGRATION_SECRET = 'elevate-secret';
    const req = new Request('http://localhost', {
      headers: { 'x-integration-key': 'elevate-secret' },
    });
    assert.equal(actzIntegrationKeyAccepted(req), false);
  });

  it('authenticates with optional handoff bearer', () => {
    const token = mintActzHandoffToken(
      'actz-handoff-secret',
      { actzProviderOrgId: 'org_1' },
      Date.now(),
    );
    const req = new Request('http://localhost', {
      headers: {
        'x-integration-key': 'actz-integration-secret',
        authorization: `Bearer ${token}`,
      },
    });
    const auth = authenticateActzPartner(req);
    assert.equal(auth.ok, true);
    if (auth.ok) assert.equal(auth.handoff?.actzProviderOrgId, 'org_1');
  });
});
