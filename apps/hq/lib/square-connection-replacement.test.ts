import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { decryptToken, loadTokenKey } from '@platform/engine';

import { replaceSquareConnection } from './square-admin';
import {
  BRAND, LOCATION, TOKEN_KEY, adminHarness, snapshot, square, stubRevoke,
  successfulMutationClaim, tokens,
} from './square-admin-test-support';

describe('replaceSquareConnection', () => {
  beforeEach(() => { process.env.SQUARE_TOKEN_KEY = TOKEN_KEY; });
  afterEach(() => { delete process.env.SQUARE_TOKEN_KEY; });

  it('claims, atomically replaces, and queues the superseded credential', async (t) => {
    const revoked = stubRevoke(t);
    const previous = snapshot();
    const h = adminHarness({ connection: previous });
    const result = await replaceSquareConnection(h.db, square, {
      brandId: BRAND, locationId: LOCATION, squareLocationId: 'square-location',
      tokens, previousConnection: previous,
    });
    assert.deepEqual(result, {
      ok: true,
      connectionId: '66666666-6666-4666-8666-666666666666',
      connectionGeneration: '77777777-7777-4777-8777-777777777777',
      previousRetirementFailed: false,
    });
    assert.deepEqual(h.calls.map((call) => call.name), [
      'claim_square_connection_mutation', 'finalize_square_connection_replacement',
    ]);
    const claim = h.calls[0]!.args;
    const finalized = h.calls[1]!.args;
    assert.equal(finalized.p_mutation_generation, claim.p_mutation_generation);
    assert.equal(finalized.p_expected_connection_id, previous.id);
    assert.equal(finalized.p_expected_connection_generation, previous.connection_generation);
    assert.equal(finalized.p_oauth_scope_contract_version, 2);
    assert.equal(decryptToken(String(finalized.p_access_token_encrypted), loadTokenKey()), 'new-access');
    assert.equal(decryptToken(String(finalized.p_refresh_token_encrypted), loadTokenKey()), 'new-refresh');
    assert.equal(h.writes[0]?.access_token_encrypted, previous.access_token_encrypted);
    assert.deepEqual(revoked, []);
  });

  it('compensates only the issued access token when payment state is active', async (t) => {
    const revoked = stubRevoke(t);
    const previous = snapshot();
    const h = adminHarness({ connection: previous, rpc: async (call) => {
      if (call.name === 'claim_square_connection_mutation') return {
        data: null, error: { message: 'square_connection_has_active_payment_state' },
      };
      return { data: false, error: null };
    } });
    assert.deepEqual(await replaceSquareConnection(h.db, square, {
      brandId: BRAND, locationId: LOCATION, squareLocationId: 'square-location',
      tokens, previousConnection: previous,
    }), { ok: false, reason: 'in_flight', cleanupFailed: false });
    assert.deepEqual(revoked, [{
      client_id: 'app', access_token: 'new-access', revoke_only_access_token: true,
    }]);
    assert.equal(h.calls.some((call) =>
      call.name === 'finalize_square_connection_replacement'), false);
  });

  it('maps an exact snapshot mismatch and cleans the issued access token', async (t) => {
    const revoked = stubRevoke(t);
    const previous = snapshot();
    const h = adminHarness({ connection: previous, rpc: async (call) =>
      call.name === 'claim_square_connection_mutation'
        ? { data: null, error: { message: 'square_connection_changed' } }
        : { data: false, error: null } });
    const result = await replaceSquareConnection(h.db, square, {
      brandId: BRAND, locationId: LOCATION, squareLocationId: 'square-location',
      tokens, previousConnection: previous,
    });
    assert.deepEqual(result, {
      ok: false, reason: 'connection_changed', cleanupFailed: false,
    });
    assert.equal(revoked[0]?.revoke_only_access_token, true);
  });

  it('retries an exact finalizer after a lost response', async (t) => {
    stubRevoke(t);
    const previous = snapshot();
    let finalizers = 0;
    const h = adminHarness({ connection: previous, rpc: async (call) => {
      if (call.name === 'claim_square_connection_mutation') {
        return successfulMutationClaim(call, previous);
      }
      if (call.name === 'finalize_square_connection_replacement') {
        finalizers += 1;
        if (finalizers === 1) throw new Error('response lost');
        return { data: { connection_id: previous.id,
          connection_generation: '88888888-8888-4888-8888-888888888888' }, error: null };
      }
      return { data: true, error: null };
    } });
    const result = await replaceSquareConnection(h.db, square, {
      brandId: BRAND, locationId: LOCATION, squareLocationId: 'square-location',
      tokens, previousConnection: previous,
    });
    assert.equal(result.ok, true);
    assert.equal(finalizers, 2);
    const calls = h.calls.filter((call) =>
      call.name === 'finalize_square_connection_replacement');
    assert.deepEqual(calls[0]?.args, calls[1]?.args);
  });

  it('retains an ambiguous fence without revoking a possibly stored token', async (t) => {
    const revoked = stubRevoke(t);
    const previous = snapshot();
    const h = adminHarness({ connection: previous, rpc: async (call) => {
      if (call.name === 'claim_square_connection_mutation') {
        return successfulMutationClaim(call, previous);
      }
      throw new Error('response lost');
    } });
    const result = await replaceSquareConnection(h.db, square, {
      brandId: BRAND, locationId: LOCATION, squareLocationId: 'square-location',
      tokens, previousConnection: previous,
    });
    assert.deepEqual(result, {
      ok: false, reason: 'storage_ambiguous', cleanupFailed: true,
    });
    assert.deepEqual(revoked, []);
    assert.equal(h.calls.some((call) => call.name === 'fail_square_connection_mutation'), false);
  });

  it('supports an initial null-snapshot connection', async (t) => {
    stubRevoke(t);
    const h = adminHarness({ connection: null });
    const result = await replaceSquareConnection(h.db, square, {
      brandId: BRAND, locationId: LOCATION, squareLocationId: 'square-location',
      tokens, previousConnection: null,
    });
    assert.equal(result.ok, true);
    assert.equal(h.calls[0]?.args.p_expected_connection_id, null);
    assert.equal(h.calls[1]?.args.p_expected_connection_generation, null);
  });
});
