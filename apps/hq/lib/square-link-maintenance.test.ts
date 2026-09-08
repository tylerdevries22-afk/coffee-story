import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encryptToken, SquareApiError, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { expireDueSquareCheckoutLinks, type DueSquareLink } from './square-link-maintenance';

const db = {} as SupabaseClient;
const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
};
const tokenKey = Buffer.alloc(32, 7);
function restoreTokenKey(value: string | undefined): void {
  if (value === undefined) delete process.env.SQUARE_TOKEN_KEY;
  else process.env.SQUARE_TOKEN_KEY = value;
}
const row = (id: string): DueSquareLink => ({
  order_id: id,
  brand_id: 'brand-a',
  location_id: 'location-a',
  expires_at: '2026-09-08T00:00:00.000Z',
  paymentLinkId: `link-${id}`,
  squareOrderId: `square-order-${id}`,
  accessTokenEncrypted: 'ciphertext',
});

describe('Square checkout link expiry', () => {
  it('confirms provider deletion before releasing each reservation', async () => {
    const calls: string[] = [];
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one'), row('two')],
      cancel: async (_config, link) => { calls.push(`cancel:${link.order_id}`); return true; },
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

  it('drains every due page in one maintenance run', async () => {
    const due = Array.from({ length: 11 }, (_, index) => row(String(index).padStart(2, '0')));
    const cursors: Array<string | undefined> = [];
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async (_db, _now, afterOrderId) => {
        cursors.push(afterOrderId);
        const start = afterOrderId ? due.findIndex((item) => item.order_id === afterOrderId) + 1 : 0;
        return due.slice(start, start + 10);
      },
      cancel: async () => true,
      finalize: async () => true,
    });
    assert.deepEqual(cursors, [undefined, '09']);
    assert.deepEqual(result,
      { scanned: 11, cancelled: 11, failed: 0, stale: 0, scanFailed: false });
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

  it('finishes a retry only after Square proves the order was cancelled', async () => {
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')],
      cancel: async () => true,
      finalize: async () => true,
    });
    assert.equal(result.cancelled, 1);
  });

  it('does not expire local state when Square cannot prove cancellation', async () => {
    let finalized = false;
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')], cancel: async () => false,
      finalize: async () => { finalized = true; return true; },
    });
    assert.equal(finalized, false);
    assert.equal(result.failed, 1);
  });

  it('requires the exact Square cancellation receipt before finalizing', async (t) => {
    const priorKey = process.env.SQUARE_TOKEN_KEY;
    process.env.SQUARE_TOKEN_KEY = tokenKey.toString('base64');
    t.after(() => { restoreTokenKey(priorKey); });
    const secured = { ...row('one'), accessTokenEncrypted: encryptToken('token', tokenKey) };
    let finalized = false;
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      id: secured.paymentLinkId,
      // Square omits cancelled_order_id if checkout already settled.
    }), { headers: { 'Content-Type': 'application/json' } }));
    const result = await expireDueSquareCheckoutLinks(db, {
      ...square, apiBase: 'https://square.example.test',
    }, new Date(), {
      load: async () => [secured], finalize: async () => { finalized = true; return true; },
    });
    assert.equal(finalized, false);
    assert.equal(result.failed, 1);
  });

  it('recovers a lost delete response from the cancelled Square order', async (t) => {
    const priorKey = process.env.SQUARE_TOKEN_KEY;
    process.env.SQUARE_TOKEN_KEY = tokenKey.toString('base64');
    t.after(() => { restoreTokenKey(priorKey); });
    const secured = { ...row('one'), accessTokenEncrypted: encryptToken('token', tokenKey) };
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (request: string | URL | Request) => {
      requests += 1;
      if (String(request).includes('/payment-links/')) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ order: {
        id: secured.squareOrderId, state: 'CANCELED', tenders: [],
      } }), { headers: { 'Content-Type': 'application/json' } });
    });
    const result = await expireDueSquareCheckoutLinks(db, {
      ...square, apiBase: 'https://square.example.test',
    }, new Date(), { load: async () => [secured], finalize: async () => true });
    assert.equal(requests, 2);
    assert.equal(result.cancelled, 1);
  });

  it('surfaces stale database state and scan failures', async () => {
    const stale = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')], cancel: async () => true, finalize: async () => false,
    });
    assert.equal(stale.stale, 1);
    const failed = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => { throw new Error('offline'); },
    });
    assert.equal(failed.scanFailed, true);
  });
});
