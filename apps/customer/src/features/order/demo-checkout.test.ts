import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DemoSyncOrder, PlaceOrderResponse } from '@platform/api-client';

import {
  checkoutAttemptSignature,
  checkoutGuestLabel,
  completeDemoCardOrder,
  demoConfirmationStatus,
} from './demo-checkout';

const ORDER: DemoSyncOrder = {
  sessionId: 'session-a', id: 'order-1', shortCode: '46', guestName: 'Demo Guest', status: 'paid',
  placedAt: '2026-08-25T16:00:00.000Z', dailyNumber: 46,
  updatedAt: '2026-08-25T16:01:00.000Z', scheduledFor: '2026-08-25T16:15:00.000Z',
  lines: [{ name: 'Latte', quantity: 1, options: [] }], totalCents: 650,
  note: '', tenderType: 'square_card', channel: 'app', fulfillmentType: 'pickup',
};
const RESPONSE: PlaceOrderResponse = {
  orderId: ORDER.id, status: 'created', subtotalCents: 650, taxCents: 0,
  tipCents: 0, totalCents: 650, dailyNumber: 46,
};

describe('shared demo card completion', () => {
  it('uses the exact canonical label sent to the shared broker', () => {
    assert.equal(checkoutGuestLabel('  Ada   Lovelace  '), 'Ada Lovelace');
    assert.equal(checkoutGuestLabel('Ada ❤'), 'Ada ❤');
  });

  it('retires checkout identity when notes or pack recipes change', () => {
    const input = {
      cart: {
        note: 'Counter pickup',
        lines: [{
          id: 'pack', itemId: 'brew-pack', name: 'Brew Pack', sizeSlug: 'one',
          sizeLabel: 'One size', basePriceCents: 1000, optionIds: [], optionSummary: '',
          unitPriceCents: 1000, quantity: 1, note: 'Whole bean',
          packContents: [{ itemSlug: 'ethiopia', name: 'Ethiopia', quantity: 2 }],
        }],
      },
      deliveryFeeCents: 0, fulfillmentMode: 'pickup', guestName: 'Ada',
      redeemCents: 0, tipCents: 0, windowValue: '2026-08-25T17:00:00.000Z',
    };
    const original = checkoutAttemptSignature(input);
    assert.notEqual(checkoutAttemptSignature({
      ...input, cart: { ...input.cart, note: 'Side door' },
    }), original);
    assert.notEqual(checkoutAttemptSignature({
      ...input,
      cart: {
        ...input.cart,
        lines: [{ ...input.cart.lines[0], packContents: [{ ...input.cart.lines[0].packContents[0], quantity: 3 }] }],
      },
    }), original);
    assert.equal(checkoutAttemptSignature({ ...input, guestName: '  Ada  ' }), original);
  });

  it('marks a newly created card order paid', async () => {
    const transitions: string[] = [];
    const result = await completeDemoCardOrder({
      orders: async () => ({ sessionId: 'session-a', revision: 1, orders: [ORDER] }),
      transition: async (_orderId, status) => {
        transitions.push(status);
        return ORDER;
      },
    }, RESPONSE);
    assert.equal(result, ORDER);
    assert.deepEqual(transitions, ['paid']);
  });

  it('accepts an idempotent replay that staff already advanced', async () => {
    let transitionCalls = 0;
    const advanced = { ...ORDER, status: 'ready' as const };
    const result = await completeDemoCardOrder({
      orders: async () => ({ sessionId: 'session-a', revision: 3, orders: [advanced] }),
      transition: async () => { transitionCalls += 1; return ORDER; },
    }, { ...RESPONSE, status: 'ready' });
    assert.equal(result, advanced);
    assert.equal(transitionCalls, 0);
  });

  it('rejects a terminal replay instead of showing a successful checkout', async () => {
    for (const status of ['cancelled', 'refunded'] as const) {
      await assert.rejects(() => completeDemoCardOrder({
        orders: async () => ({
          sessionId: 'session-a', revision: 3, orders: [{ ...ORDER, status }],
        }),
        transition: async () => ORDER,
      }, { ...RESPONSE, status }), /already cancelled or refunded/);
    }
  });

  it('fails explicitly when a replay cannot be recovered', async () => {
    await assert.rejects(() => completeDemoCardOrder({
      orders: async () => ({ sessionId: 'session-a', revision: 0, orders: [] }),
      transition: async () => ORDER,
    }, { ...RESPONSE, status: 'in_progress' }), /could not recover/);
  });
});

describe('shared demo confirmation reconciliation', () => {
  it('follows its placement session and retires the confirmation after a restart', () => {
    assert.equal(demoConfirmationStatus('paid', ORDER.id, 'session-a', {
      sessionId: 'session-a', revision: 2, orders: [{ ...ORDER, status: 'ready' }],
    }), 'ready');
    assert.equal(demoConfirmationStatus('paid', ORDER.id, 'session-a', {
      sessionId: 'session-a', revision: 2, orders: [],
    }), 'paid');
    assert.equal(demoConfirmationStatus('paid', ORDER.id, 'session-a', {
      sessionId: 'session-b', revision: 0, orders: [],
    }), 'cancelled');
  });
});
