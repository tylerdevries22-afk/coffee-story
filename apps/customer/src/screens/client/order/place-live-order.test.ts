import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlaceOrderResponse } from '@platform/api-client';

import { type LiveOrderDependencies, placeLiveOrderCore } from './place-live-order-core';
import type { SubmittedOrder } from './submitted-order';
import type { OrderState } from './use-order-state';

const RESPONSE: PlaceOrderResponse = {
  orderId: 'order-1', status: 'created', subtotalCents: 600,
  taxCents: 48, tipCents: 100, totalCents: 748, dailyNumber: 12,
};

const SUBMITTED = {
  submittedFulfillment: { mode: 'pickup', locationId: 'location-1' },
  submittedWindowValue: '2026-09-07T18:00:00.000Z',
  submittedCart: {
    note: 'No lid',
    lines: [{
      id: 'line-1', itemId: 'latte-12oz', name: 'Latte', sizeSlug: '12oz',
      sizeLabel: '12 oz', basePriceCents: 600, optionIds: ['oat'],
      optionSummary: 'Oat', unitPriceCents: 600, quantity: 1,
    }],
  },
  submittedTipCents: 100,
  submittedTotals: { subtotalCents: 600, discountCents: 0, taxCents: 48, tipCents: 100, totalCents: 748 },
  submittedSignature: 'cart-a',
  submittedGuestLabel: 'Ada',
  summary: 'Pickup at Havana',
} as unknown as SubmittedOrder;

function stateFixture(signature = 'cart-a') {
  const events: string[] = [];
  const placed: { points: number }[] = [];
  const state = {
    order: {
      clearBag: () => events.push('clear-bag'),
      setTipCents: (value: number) => events.push(`tip:${value}`),
    },
    setOverlay: (value: string) => events.push(`overlay:${value}`),
    setPaying: (value: boolean) => events.push(`paying:${value}`),
    placing: { current: true },
    setPayError: (value: string) => events.push(`error:${value}`),
    setRedeemCents: (value: number) => events.push(`redeem:${value}`),
    setUseGiftBalance: (value: boolean) => events.push(`gift:${value}`),
    setPlaced: (value: PlaceOrderResponse & { points: number }) => {
      events.push(`placed:${value.orderId}`);
      placed.push({ points: value.points });
    },
    checkoutKey: { current: null as string | null },
    cartSignatureRef: { current: signature },
    pointsPerDollar: 11,
  } as unknown as OrderState;
  return { events, placed, state };
}

function dependencies(placeOrder: LiveOrderDependencies['placeOrder']): LiveOrderDependencies {
  return {
    configured: true,
    loadLocationId: async () => 'location-1',
    placeOrder,
    createKey: () => 'attempt-1',
    notify: async () => undefined,
  };
}

describe('live order placement', () => {
  it('confirms a completed request without clearing a cart changed in flight', async () => {
    const { events, state } = stateFixture();
    let resolveRequest: (value: PlaceOrderResponse) => void = () => undefined;
    const request = new Promise<PlaceOrderResponse>((resolve) => { resolveRequest = resolve; });
    let started = false;
    const pending = placeLiveOrderCore(state, SUBMITTED, dependencies(async (body, key) => {
      started = true;
      assert.equal(body.lines[0]?.itemSlug, 'latte-12oz');
      assert.equal(body.maximumTotalCents, SUBMITTED.submittedTotals.totalCents);
      assert.equal(body.guestLabel, SUBMITTED.submittedGuestLabel);
      assert.equal(key, 'attempt-1');
      return request;
    }));
    while (!started) await Promise.resolve();
    state.cartSignatureRef.current = 'cart-b';
    resolveRequest(RESPONSE);
    await pending;

    assert.ok(events.includes('placed:order-1'));
    assert.ok(events.includes('overlay:placed'));
    assert.ok(!events.includes('clear-bag'));
    assert.equal(state.checkoutKey.current, null);
    assert.equal(state.placing.current, false);
    assert.equal(events.at(-1), 'paying:false');
  });

  it('clears only the submitted cart after a successful placement', async () => {
    const { events, placed, state } = stateFixture();
    await placeLiveOrderCore(state, SUBMITTED, dependencies(async () => RESPONSE));
    assert.deepEqual(placed, [{ points: 66 }]);
    assert.deepEqual(events.filter((event) => ['clear-bag', 'tip:0', 'redeem:0', 'gift:false'].includes(event)), [
      'clear-bag', 'tip:0', 'redeem:0', 'gift:false',
    ]);
  });

  it('keeps the attempt key for a safe retry and restores controls on failure', async () => {
    const { events, state } = stateFixture();
    await placeLiveOrderCore(state, SUBMITTED, dependencies(async () => {
      throw new Error('request timed out');
    }));
    assert.equal(state.checkoutKey.current, 'attempt-1');
    assert.ok(events.includes('error:request timed out'));
    assert.ok(!events.includes('placed:order-1'));
    assert.equal(state.placing.current, false);
    assert.equal(events.at(-1), 'paying:false');
  });
});
