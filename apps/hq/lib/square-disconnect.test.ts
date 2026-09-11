import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  disconnectSquare, SquareAdminError,
} from './square-admin';
import {
  BRAND, LOCATION, OTHER_LOCATION, TOKEN_KEY, adminHarness, guest, manager, owner,
  stubRevoke,
} from './square-admin-test-support';

describe('disconnectSquare', () => {
  beforeEach(() => {
    process.env.SQUARE_APP_ID = 'app';
    process.env.SQUARE_APP_SECRET = 'secret';
    process.env.SQUARE_TOKEN_KEY = TOKEN_KEY;
  });
  afterEach(() => {
    delete process.env.SQUARE_APP_ID;
    delete process.env.SQUARE_APP_SECRET;
    delete process.env.SQUARE_TOKEN_KEY;
  });

  it('claims the exact snapshot before full provider revoke and finalization', async (t) => {
    const revoked = stubRevoke(t);
    const h = adminHarness();
    assert.deepEqual(await disconnectSquare(h.db, owner, LOCATION), { outcome: 'revoked' });
    assert.deepEqual(h.calls.map((call) => call.name), [
      'claim_square_connection_mutation', 'finalize_square_connection_disconnect',
    ]);
    const claim = h.calls[0]!.args;
    assert.equal(claim.p_mutation_kind, 'disconnect');
    assert.equal(claim.p_expected_connection_id, '44444444-4444-4444-8444-444444444444');
    assert.equal(claim.p_expected_connection_generation, '55555555-5555-4555-8555-555555555555');
    assert.equal(h.calls[1]!.args.p_mutation_generation, claim.p_mutation_generation);
    assert.deepEqual(revoked, [{ client_id: 'app', access_token: 'old-access' }]);
  });

  it('leaves the connection unchanged while payment or remediation state is active', async (t) => {
    const revoked = stubRevoke(t);
    for (const message of [
      'square_connection_has_active_payment_state',
      'square_connection_transition_in_progress',
    ]) {
      const h = adminHarness({ rpc: async () => ({ data: null, error: { message } }) });
      assert.deepEqual(await disconnectSquare(h.db, owner, LOCATION), { outcome: 'in_flight' });
      assert.equal(h.calls.length, 1);
    }
    assert.deepEqual(revoked, []);
  });

  it('reports a changed snapshot without revoking either credential', async (t) => {
    const revoked = stubRevoke(t);
    const h = adminHarness({ rpc: async () => ({
      data: null, error: { message: 'square_connection_changed' },
    }) });
    assert.deepEqual(await disconnectSquare(h.db, owner, LOCATION), { outcome: 'changed' });
    assert.deepEqual(revoked, []);
  });

  it('retains the mutation fence after an unconfirmed provider revocation', async (t) => {
    stubRevoke(t, false);
    const h = adminHarness();
    assert.deepEqual(await disconnectSquare(h.db, owner, LOCATION), { outcome: 'stranded' });
    assert.deepEqual(h.calls.map((call) => call.name), ['claim_square_connection_mutation']);
  });

  it('releases the claim when credentials fail before the provider call', async () => {
    const h = adminHarness();
    delete process.env.SQUARE_TOKEN_KEY;
    assert.deepEqual(await disconnectSquare(h.db, owner, LOCATION), { outcome: 'failed' });
    assert.deepEqual(h.calls.map((call) => call.name), [
      'claim_square_connection_mutation', 'fail_square_connection_mutation',
    ]);
  });

  it('refuses unauthorized or missing connections before provider work', async (t) => {
    const revoked = stubRevoke(t);
    for (const [claims, locationId, code] of [
      [guest, LOCATION, 'forbidden'],
      [manager, OTHER_LOCATION, 'forbidden'],
      [owner, '', 'invalid_request'],
    ] as const) {
      await assert.rejects(() => disconnectSquare(adminHarness().db, claims, locationId),
        (error: unknown) => error instanceof SquareAdminError && error.code === code);
    }
    await assert.rejects(() => disconnectSquare(
      adminHarness({ connection: null }).db, owner, LOCATION,
    ), (error: unknown) => error instanceof SquareAdminError && error.code === 'not_connected');
    assert.deepEqual(revoked, []);
  });

  it('always scopes the snapshot read to the caller tenant', async (t) => {
    stubRevoke(t);
    const h = adminHarness();
    await disconnectSquare(h.db, owner, LOCATION);
    assert.ok(h.filters.some((filter) => filter.brand_id === BRAND));
    assert.ok(h.filters.some((filter) => filter.location_id === LOCATION));
  });
});
