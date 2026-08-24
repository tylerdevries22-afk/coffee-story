/**
 * Taking the money.
 *
 * The order is created first and paid second, deliberately. Authorising first
 * would mean a timeout could leave a charge with no order behind it, which is
 * the strictly worse failure: an order with no payment is a row a shop can see
 * and settle, a payment with no order is a refund nobody knows to make.
 *
 * Three rules carry the whole module, and each exists because the alternative
 * costs a guest money:
 *
 * 1. **One idempotency key per attempt, retired only when the cart changes.**
 *    The key becomes `orders.client_key`, so a retry of a request that may
 *    already have created an order returns that same order instead of a second
 *    one. The customer app learned the other half the hard way: a timed-out
 *    request that HAD written the order, plus an added item, plus a retry,
 *    replayed the original order, cleared the bag, said "Order placed", and the
 *    added item was never ordered. Hence `cartChanged`.
 * 2. **A timeout never offers another tender.** The first request may have
 *    succeeded. Retry the same key, or fetch someone -- offering "try a
 *    different card" after a timeout is how a shop double-charges.
 * 3. **Success is terminal.** A double-tap on a completion screen cannot
 *    re-place, because the reducer returns the state it was given.
 *
 * Pure, so `node:test` covers all of it.
 */

export type CheckoutPhase =
  /** A tender is chosen; nothing has been sent. The only cancellable state. */
  | 'idle'
  /** POST /orders is in flight. */
  | 'placing'
  /** The order exists; the reader is in flight. */
  | 'authorizing'
  | 'succeeded'
  /** A definite no: declined, or a request the server refused. */
  | 'failed'
  /** No answer. The dangerous one -- it may or may not have worked. */
  | 'timedOut';

export type CheckoutState = {
  phase: CheckoutPhase;
  /** Persisted across retries; only a cart change retires it. */
  attemptKey: string | null;
  orderId: string | null;
  errorCode: string | null;
  /** Round trips asked for on this cart. Escalates the advice. */
  attempts: number;
};

export const IDLE_CHECKOUT: CheckoutState = {
  phase: 'idle', attemptKey: null, orderId: null, errorCode: null, attempts: 0,
};

export type CheckoutEvent =
  | { type: 'place'; attemptKey: string }
  | { type: 'placed'; orderId: string }
  | { type: 'authorized' }
  | { type: 'failed'; code: string }
  | { type: 'timedOut' }
  | { type: 'retry' }
  | { type: 'cartChanged' };

/** Only before anything has been sent. */
export function isCancellable(phase: CheckoutPhase): boolean {
  return phase === 'idle';
}

/**
 * Whether there is a key an in-flight cart is already committed to.
 *
 * This used to ask the PHASE -- true for 'timedOut' and 'failed' -- and that was
 * wrong in the one sequence a guest actually produces. The failure screen offers
 * a Retry, `retry` returns the machine to 'idle', and only then does the screen
 * re-send; by that point the phase is 'idle', the old predicate said false, and
 * the re-send minted a fresh key. A timed-out request that HAD created the order
 * would then create a second one.
 *
 * The key belongs to the CART, not to a phase. It is minted once and retired by
 * exactly one event, `cartChanged`.
 */
export function reusesAttemptKey(state: CheckoutState): boolean {
  return state.attemptKey !== null;
}

export type CheckoutAdvice = 'none' | 'retry' | 'choose-another-tender' | 'see-staff';

export function recoveryAdvice(state: CheckoutState): CheckoutAdvice {
  if (state.phase === 'timedOut') {
    // Never "try a different card" here: the first request may have gone
    // through, and a second tender would charge twice.
    return state.attempts >= 2 ? 'see-staff' : 'retry';
  }
  if (state.phase === 'failed') return 'choose-another-tender';
  return 'none';
}

export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  // Terminal. A double-tap on the completion screen must not re-place, and a
  // late reply from an abandoned request must not reopen a finished checkout.
  if (state.phase === 'succeeded' && event.type !== 'cartChanged') return state;

  switch (event.type) {
    case 'place': {
      if (state.phase === 'placing' || state.phase === 'authorizing') return state;
      return {
        ...state,
        phase: 'placing',
        // The cart's key wins whenever there is one, so a re-send after a
        // timeout or a decline replays as the same order rather than making a
        // second. Only `cartChanged` clears it.
        attemptKey: state.attemptKey ?? event.attemptKey,
        errorCode: null,
        attempts: state.attempts + 1,
      };
    }
    case 'placed': {
      if (state.phase !== 'placing') return state;
      return { ...state, phase: 'authorizing', orderId: event.orderId, errorCode: null };
    }
    case 'authorized': {
      if (state.phase !== 'authorizing') return state;
      return { ...state, phase: 'succeeded', errorCode: null };
    }
    case 'failed': {
      if (state.phase !== 'placing' && state.phase !== 'authorizing') return state;
      return { ...state, phase: 'failed', errorCode: event.code };
    }
    case 'timedOut': {
      if (state.phase !== 'placing' && state.phase !== 'authorizing') return state;
      return { ...state, phase: 'timedOut', errorCode: 'timeout' };
    }
    case 'retry': {
      if (state.phase !== 'failed' && state.phase !== 'timedOut') return state;
      return { ...state, phase: 'idle', errorCode: null };
    }
    case 'cartChanged': {
      // The key belongs to a cart. Once the cart moves, replaying the old key
      // would return the old order and quietly drop whatever was added.
      return { ...IDLE_CHECKOUT };
    }
    default:
      return state;
  }
}
