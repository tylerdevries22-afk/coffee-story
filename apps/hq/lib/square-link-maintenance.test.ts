import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SquareApiError, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { expireDueSquareCheckoutLinks, type DueSquareLink } from './square-link-maintenance';

const db = {} as SupabaseClient;
const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
};
const row = (id: string): DueSquareLink => ({
  order_id: id,
  brand_id: 'brand-a',
  location_id: 'location-a',
  expires_at: '2026-09-08T00:00:00.000Z',
  paymentLinkId: `link-${id}`,
  accessTokenEncrypted: 'ciphertext',
});

describe('Square checkout link expiry', () => {
  it('confirms provider deletion before releasing each reservation', async () => {
    const calls: string[] = [];
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one'), row('two')],
      cancel: async (_config, link) => { calls.push(`cancel:${link.order_id}`); },
      finalize: async (_db, link) => {
        calls.push(`finalize:${link.order_id}`);
        return true;
      },
    });
    assert.deepEqual(result,
      { scanned: 2, cancelled: 2, failed: 0, stale: 0, scanFailed: false });
    for (const id of ['one', 'two']) {
      assert.ok(calls.indexOf(`cancel:${id}`) < calls.indexOf(`finalize:${id}`));
    }
  });

  it('keeps capacity when Square rejects cancellation', async () => {
    let finalized = false;
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')],
      cancel: async () => { throw new SquareApiError('busy', 503, {}); },
      finalize: async () => { finalized = true; return true; },
    });
    assert.equal(finalized, false);
    assert.deepEqual(result,
      { scanned: 1, cancelled: 0, failed: 1, stale: 0, scanFailed: false });
  });

  it('finishes a retry when Square says the stored link is already absent', async () => {
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')],
      cancel: async () => { throw new SquareApiError('absent', 404, {}); },
      finalize: async () => true,
    });
    assert.equal(result.cancelled, 1);
  });

  it('surfaces stale database state and scan failures', async () => {
    const stale = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')], cancel: async () => {}, finalize: async () => false,
    });
    assert.equal(stale.stale, 1);
    const failed = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => { throw new Error('offline'); },
    });
    assert.equal(failed.scanFailed, true);
  });
});
