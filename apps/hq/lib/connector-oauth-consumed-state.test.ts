import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseConsumedConnectorState } from './connector-oauth-callback-contract';

const IDS = {
  state: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  installation: '33333333-3333-4333-8333-333333333333',
  operation: '44444444-4444-4444-8444-444444444444',
  reference: '55555555-5555-4555-8555-555555555555',
  lease: '66666666-6666-4666-8666-666666666666',
};

function active(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    state_id: IDS.state, brand_id: IDS.brand, installation_id: IDS.installation,
    cookie_binding_hash: 'binding-hash', consume_key: IDS.operation,
    redirect_uri: 'https://hq.example.test/callback', requested_scopes: ['openid'],
    consume_replayed: false, completion_outcome: null, completed_reference_id: null,
    processing_lease_token: IDS.lease,
    processing_lease_expires_at: '2026-09-08T12:02:00.000Z',
    processing_generation: 1, processing_acquired: true, exchange_started: false,
    ...overrides,
  };
}

function parse(value: unknown) {
  return parseConsumedConnectorState(value, 'binding-hash', IDS.operation);
}

describe('consumed connector OAuth state', () => {
  it('accepts only coherent active processing states', () => {
    assert.ok(parse(active()));
    assert.ok(parse(active({
      consume_replayed: true, processing_acquired: false, exchange_started: true,
    })));
    assert.equal(parse(active({ processing_acquired: false })), null);
    assert.equal(parse(active({ exchange_started: true })), null);
    assert.equal(parse(active({
      consume_replayed: true, processing_acquired: true, exchange_started: true,
    })), null);
  });

  it('accepts a terminal replay only after its processing lease is cleared', () => {
    const terminal = active({
      consume_replayed: true, completion_outcome: 'connected',
      completed_reference_id: IDS.reference, processing_lease_token: null,
      processing_lease_expires_at: null, processing_acquired: false,
    });
    assert.ok(parse(terminal));
    assert.equal(parse({ ...terminal, processing_lease_token: IDS.lease }), null);
  });
});
