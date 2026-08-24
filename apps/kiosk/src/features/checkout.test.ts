import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  IDLE_CHECKOUT, checkoutReducer, isCancellable, recoveryAdvice, reusesAttemptKey,
  type CheckoutEvent, type CheckoutPhase, type CheckoutState,
} from './checkout';

const PHASES: CheckoutPhase[] = ['idle', 'placing', 'authorizing', 'succeeded', 'failed', 'timedOut'];
const EVENTS: CheckoutEvent[] = [
  { type: 'place', attemptKey: 'k2' },
  { type: 'placed', orderId: 'o1' },
  { type: 'authorized' },
  { type: 'failed', code: 'declined' },
  { type: 'timedOut' },
  { type: 'retry' },
  { type: 'cartChanged' },
];

function at(phase: CheckoutPhase, overrides: Partial<CheckoutState> = {}): CheckoutState {
  return { ...IDLE_CHECKOUT, phase, attemptKey: 'k1', attempts: 1, ...overrides };
}

function happyPath(): CheckoutState {
  let state = checkoutReducer(IDLE_CHECKOUT, { type: 'place', attemptKey: 'k1' });
  state = checkoutReducer(state, { type: 'placed', orderId: 'order-1' });
  return checkoutReducer(state, { type: 'authorized' });
}

describe('the happy path', () => {
  it('ends succeeded, holding the order it created', () => {
    const state = happyPath();
    assert.equal(state.phase, 'succeeded');
    assert.equal(state.orderId, 'order-1');
  });

  it('creates the order before it charges', () => {
    // Authorising first would let a timeout leave a charge with no order --
    // a refund nobody knows to make.
    const placing = checkoutReducer(IDLE_CHECKOUT, { type: 'place', attemptKey: 'k1' });
    assert.equal(placing.phase, 'placing');
    assert.equal(checkoutReducer(placing, { type: 'authorized' }).phase, 'placing');
  });
});

describe('cancellability', () => {
  it('lets a guest back out only before anything has been sent', () => {
    assert.equal(isCancellable('idle'), true);
    for (const phase of PHASES.filter((value) => value !== 'idle')) {
      assert.equal(isCancellable(phase), false, `${phase} must not be cancellable`);
    }
  });
});

describe('idempotency', () => {
  /**
   * The invariant the whole module exists for, exercised through the sequence a
   * guest actually produces: the screen offers a Retry, which returns to idle,
   * and only then is a second request sent. Asserting only on the timedOut
   * state would miss that the key is chosen at `place`, not at `retry`.
   */
  it('keeps the original key across timeout, retry, and the re-send', () => {
    const timedOut = checkoutReducer(
      checkoutReducer(IDLE_CHECKOUT, { type: 'place', attemptKey: 'k1' }),
      { type: 'timedOut' },
    );
    const retried = checkoutReducer(timedOut, { type: 'retry' });
    assert.equal(retried.attemptKey, 'k1', 'retry must not discard the key');
    const resent = checkoutReducer(retried, { type: 'place', attemptKey: 'k-fresh' });
    assert.equal(
      resent.attemptKey, 'k1',
      're-sending after a timeout with a NEW key creates a second order for a request that may already have succeeded',
    );
  });

  it('keeps the original key after a decline and re-send', () => {
    const failed = checkoutReducer(
      checkoutReducer(IDLE_CHECKOUT, { type: 'place', attemptKey: 'k1' }),
      { type: 'failed', code: 'declined' },
    );
    const resent = checkoutReducer(
      checkoutReducer(failed, { type: 'retry' }),
      { type: 'place', attemptKey: 'k-fresh' },
    );
    assert.equal(resent.attemptKey, 'k1');
  });

  /**
   * The customer app's bug, prevented: a timed-out request that HAD written the
   * order, plus an added item, plus a retry, replayed the original order and
   * the added item was never ordered.
   */
  it('retires the key the moment the cart changes', () => {
    const cleared = checkoutReducer(at('timedOut'), { type: 'cartChanged' });
    assert.deepEqual(cleared, IDLE_CHECKOUT);
    assert.equal(checkoutReducer(cleared, { type: 'place', attemptKey: 'k2' }).attemptKey, 'k2');
  });

  it('mints a fresh key for a genuinely new checkout', () => {
    assert.equal(
      checkoutReducer(IDLE_CHECKOUT, { type: 'place', attemptKey: 'k9' }).attemptKey,
      'k9',
    );
  });

  it('reports a committed key for every phase reachable after a send', () => {
    // The predicate asks the cart, not the phase -- 'idle' after a retry still
    // carries the key the first attempt used.
    assert.equal(reusesAttemptKey(IDLE_CHECKOUT), false);
    for (const phase of PHASES) {
      assert.equal(reusesAttemptKey(at(phase)), true, phase);
    }
  });
});

describe('recovery advice', () => {
  /** After a timeout the first request may have succeeded. */
  it('never offers another tender after a timeout', () => {
    for (let attempts = 1; attempts <= 5; attempts += 1) {
      assert.notEqual(
        recoveryAdvice(at('timedOut', { attempts })), 'retry-payment',
        `attempts=${attempts}`,
      );
    }
    assert.equal(recoveryAdvice(at('timedOut', { attempts: 1 })), 'retry');
    assert.equal(recoveryAdvice(at('timedOut', { attempts: 2 })), 'see-staff');
  });

  it('retries a definite decline in place so the order key survives', () => {
    assert.equal(recoveryAdvice(at('failed', { errorCode: 'declined' })), 'retry-payment');
  });

  it('sends configuration and order failures to staff instead of another tender', () => {
    assert.equal(recoveryAdvice(at('failed', { errorCode: 'api_not_configured' })), 'see-staff');
    assert.equal(recoveryAdvice(at('failed', { errorCode: 'order_ordering_paused' })), 'see-staff');
    assert.equal(recoveryAdvice(at('failed', { errorCode: 'reader_unavailable' })), 'see-staff');
  });

  it('has nothing to say while things are working', () => {
    assert.equal(recoveryAdvice(IDLE_CHECKOUT), 'none');
    assert.equal(recoveryAdvice(at('placing')), 'none');
    assert.equal(recoveryAdvice(happyPath()), 'none');
  });
});

describe('the reducer as a whole', () => {
  it('is total: every phase survives every event', () => {
    for (const phase of PHASES) {
      for (const event of EVENTS) {
        const next = checkoutReducer(at(phase), event);
        assert.ok(PHASES.includes(next.phase), `${phase} + ${event.type} left the machine`);
      }
    }
  });

  it('never enters placing without a key to place under', () => {
    for (const phase of PHASES) {
      for (const event of EVENTS) {
        const next = checkoutReducer(at(phase), event);
        if (next.phase === 'placing') {
          assert.ok(next.attemptKey, `${phase} + ${event.type} placed with no key`);
        }
      }
    }
  });

  it('treats success as terminal, so a double-tap cannot re-place', () => {
    const done = happyPath();
    for (const event of EVENTS.filter((value) => value.type !== 'cartChanged')) {
      assert.equal(checkoutReducer(done, event), done, `${event.type} disturbed a finished order`);
    }
  });

  it('lets a finished order be cleared for the next guest', () => {
    assert.deepEqual(checkoutReducer(happyPath(), { type: 'cartChanged' }), IDLE_CHECKOUT);
  });

  it('ignores a second place while one is already in flight', () => {
    const placing = at('placing');
    assert.equal(checkoutReducer(placing, { type: 'place', attemptKey: 'k9' }), placing);
  });
});
