import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, AppNetworkError, type PlaceOrderRequest, type PlaceOrderResponse } from '@platform/api-client';

import { checkoutReducer, IDLE_CHECKOUT } from './checkout';
import {
  checkoutAttemptKey,
  checkoutPreflight,
  checkoutTender,
  checkoutTarget,
  demoReplayOutcome,
  paymentAmountCents,
  placeCheckoutOrder,
  placementFailure,
  type CheckoutDeviceSnapshot,
} from './checkout-runtime';

const UNPAIRED: CheckoutDeviceSnapshot = {
  status: 'unpaired', accessToken: null, locationId: null,
};
const READY: CheckoutDeviceSnapshot = {
  status: 'ready', accessToken: 'device-token', locationId: 'location-1',
};
const REQUEST: PlaceOrderRequest = {
  locationId: 'location-1', fulfillmentType: 'pickup', lines: [], tipCents: 0, tenderType: 'pay_at_pickup',
};
const RESPONSE: PlaceOrderResponse = {
  orderId: 'order-1', status: 'created', subtotalCents: 500, taxCents: 40, tipCents: 0, totalCents: 540,
};
const WEB_CARD = { platform: 'web', readerIsSimulated: true, requiresReader: true };
const NATIVE_CARD = { platform: 'ios', readerIsSimulated: true, requiresReader: true };
const NATIVE_CASH = { platform: 'ios', readerIsSimulated: true, requiresReader: false };

describe('checkoutTarget', () => {
  it('allows demo checkout only for an explicitly unpaired web preview', () => {
    let clientCalls = 0;
    const target = checkoutTarget(UNPAIRED, () => { clientCalls += 1; return null; }, WEB_CARD);
    assert.deepEqual(target, { kind: 'demo' });
    assert.equal(clientCalls, 0);
    assert.deepEqual(
      checkoutTarget(UNPAIRED, () => null, NATIVE_CARD),
      { kind: 'blocked', code: 'device_unpaired' },
    );
  });

  it('blocks every unresolved or revoked device state', () => {
    for (const status of ['loading', 'revoked'] as const) {
      for (const runtime of [WEB_CARD, NATIVE_CARD]) {
        assert.deepEqual(
          checkoutTarget({ ...UNPAIRED, status }, () => null, runtime),
          { kind: 'blocked', code: `device_${status}` },
        );
      }
    }
  });

  it('blocks a paired device missing identity, API config, or a real reader', () => {
    assert.deepEqual(
      checkoutTarget({ ...READY, accessToken: null }, () => null, NATIVE_CASH),
      { kind: 'blocked', code: 'device_identity_missing' },
    );
    assert.deepEqual(
      checkoutTarget({ ...READY, locationId: null }, () => null, NATIVE_CASH),
      { kind: 'blocked', code: 'device_identity_missing' },
    );
    assert.deepEqual(
      checkoutTarget(READY, () => null, NATIVE_CASH),
      { kind: 'blocked', code: 'api_not_configured' },
    );
    assert.deepEqual(
      checkoutTarget(READY, () => ({ placeOrder: async () => RESPONSE }), NATIVE_CARD),
      { kind: 'blocked', code: 'reader_not_configured' },
    );
  });

  it('binds a complete paired device to the live API', () => {
    const client = { placeOrder: async () => RESPONSE };
    const target = checkoutTarget(READY, (token) => {
      assert.equal(token, 'device-token');
      return client;
    }, NATIVE_CASH);
    assert.deepEqual(target, { kind: 'live', client, locationId: 'location-1' });
  });

  it('forces a paired preview kiosk onto the synchronized demo plane', () => {
    const demoClient = { placeOrder: async () => RESPONSE };
    let liveClientCalls = 0;
    const target = checkoutTarget(READY, () => {
      liveClientCalls += 1;
      return { placeOrder: async () => RESPONSE };
    }, {
      ...WEB_CARD,
      demoClient,
      demoLocationId: 'demo',
      forceDemo: true,
    });

    assert.deepEqual(target, { kind: 'demo', client: demoClient, locationId: 'demo' });
    assert.equal(liveClientCalls, 0);
  });

  it('fails closed when a forced preview has no synchronized broker', () => {
    assert.deepEqual(
      checkoutTarget(READY, () => ({ placeOrder: async () => RESPONSE }), {
        ...WEB_CARD,
        forceDemo: true,
      }),
      { kind: 'blocked', code: 'demo_sync_not_configured' },
    );
  });
});

describe('demoReplayOutcome', () => {
  it('continues only an unpaid order and never revives cancelled or refunded work', () => {
    assert.equal(demoReplayOutcome('created'), 'continue');
    assert.equal(demoReplayOutcome('paid'), 'already_authorized');
    assert.equal(demoReplayOutcome('in_progress'), 'already_authorized');
    assert.equal(demoReplayOutcome('ready'), 'already_authorized');
    assert.equal(demoReplayOutcome('picked_up'), 'already_authorized');
    assert.equal(demoReplayOutcome('cancelled'), 'terminal');
    assert.equal(demoReplayOutcome('refunded'), 'terminal');
  });
});

describe('checkout tender and totals', () => {
  it('maps card to the reader and cash to pay-at-pickup', () => {
    assert.deepEqual(checkoutTender('card'), { tenderType: 'square_card', requiresReader: true });
    assert.deepEqual(checkoutTender('cash'), { tenderType: 'pay_at_pickup', requiresReader: false });
    assert.equal(checkoutTender('gift_card'), null);
    assert.equal(checkoutTender('stored_value'), null);
    assert.equal(checkoutTender(null), null);
  });

  it('uses the server-repriced total for live orders and local math only for demo', () => {
    assert.equal(paymentAmountCents({ kind: 'placed', order: RESPONSE }, 999), 540);
    assert.equal(paymentAmountCents({ kind: 'demo', orderId: 'demo-1' }, 999), 999);
  });

  it('uses one preflight contract for advertised and executed tenders', () => {
    assert.deepEqual(
      checkoutPreflight('card', UNPAIRED, () => null, {
        platform: 'web', readerIsSimulated: true,
      }),
      {
        kind: 'ready',
        target: { kind: 'demo' },
        tender: { tenderType: 'square_card', requiresReader: true },
      },
    );
    assert.deepEqual(
      checkoutPreflight('card', READY, () => ({ placeOrder: async () => RESPONSE }), {
        platform: 'ios', readerIsSimulated: true,
      }),
      { kind: 'blocked', code: 'reader_not_configured' },
    );
    assert.deepEqual(
      checkoutPreflight(null, READY, () => ({ placeOrder: async () => RESPONSE }), {
        platform: 'ios', readerIsSimulated: false,
      }),
      { kind: 'blocked', code: 'tender_not_supported' },
    );
  });
});

describe('idempotent placement', () => {
  it('uses the original key on a user-visible retry', async () => {
    const keys: string[] = [];
    const client = {
      placeOrder: async (_input: PlaceOrderRequest, key: string) => {
        keys.push(key);
        throw new AppNetworkError('timeout', 'timed out');
      },
    };
    const target = checkoutTarget(READY, () => client, NATIVE_CASH);
    const firstKey = checkoutAttemptKey(IDLE_CHECKOUT, () => 'key-1');
    const sent = checkoutReducer(IDLE_CHECKOUT, { type: 'place', attemptKey: firstKey });
    const retried = checkoutReducer(
      checkoutReducer(sent, { type: 'timedOut' }),
      { type: 'retry' },
    );
    const retryKey = checkoutAttemptKey(retried, () => 'must-not-be-used');

    await placeCheckoutOrder(target, firstKey, () => REQUEST);
    await placeCheckoutOrder(target, retryKey, () => REQUEST);

    assert.equal(retryKey, 'key-1');
    assert.deepEqual(keys, ['key-1', 'key-1']);
  });

  it('never builds or posts an order for a blocked paired device', async () => {
    let requested = false;
    const result = await placeCheckoutOrder(
      checkoutTarget(READY, () => null, NATIVE_CASH),
      'key-1',
      () => { requested = true; return REQUEST; },
    );
    assert.deepEqual(result, { kind: 'failed', code: 'api_not_configured' });
    assert.equal(requested, false);
  });

  it('keeps the explicit unpaired demo local', async () => {
    const result = await placeCheckoutOrder(
      checkoutTarget(UNPAIRED, () => null, WEB_CARD),
      'demo-key',
      () => { throw new Error('demo must not build a live request'); },
    );
    assert.deepEqual(result, { kind: 'demo', orderId: 'demo-key' });
  });

  it('posts an explicitly configured web demo and uses the returned ticket', async () => {
    const requests: PlaceOrderRequest[] = [];
    const client = { placeOrder: async (input: PlaceOrderRequest) => { requests.push(input); return RESPONSE; } };
    const target = checkoutTarget(UNPAIRED, () => null, {
      ...WEB_CARD, demoClient: client, demoLocationId: 'demo',
    });
    const result = await placeCheckoutOrder(target, 'demo-key', (locationId) => ({ ...REQUEST, locationId }));
    assert.deepEqual(result, { kind: 'placed', order: RESPONSE });
    assert.equal(requests[0]?.locationId, 'demo');
  });
});

describe('placement failure classification', () => {
  it('treats every network no-answer as ambiguous', () => {
    assert.deepEqual(placementFailure(new AppNetworkError('timeout', 'late')), { kind: 'ambiguous' });
    assert.deepEqual(placementFailure(new AppNetworkError('request_failed', 'offline')), { kind: 'ambiguous' });
    assert.deepEqual(placementFailure(new SyntaxError('bad response JSON')), { kind: 'ambiguous' });
  });

  it('preserves a definite API rejection without exposing its message', () => {
    assert.deepEqual(
      placementFailure(new ApiError(409, 'ordering_paused', 'internal detail')),
      { kind: 'failed', code: 'order_ordering_paused' },
    );
  });
});
