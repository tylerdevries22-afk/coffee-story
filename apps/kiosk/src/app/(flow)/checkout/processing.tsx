import { useEffect, useReducer, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { newIdempotencyKey } from '@platform/api-client';
import { orderSubtotalCents, orderTotals, ticketCallout } from '@platform/domain';

import { ProcessingView } from '@/components/checkout/processing-view';
import { IDLE_CHECKOUT, checkoutReducer, recoveryAdvice } from '@/features/checkout';
import {
  checkoutAttemptKey, checkoutPreflight, demoReplayOutcome, paymentAmountCents,
  placeCheckoutOrder,
} from '@/features/checkout-runtime';
import { toPlaceOrderRequest } from '@/features/order-request';
import { deviceApiClient } from '@/lib/api';
import { authorize, CARD_READER_IS_SIMULATED } from '@/lib/card-reader';
import { demoSyncClient, demoSyncPreview } from '@/lib/demo-sync';
import * as haptics from '@/lib/haptics';
import { useDevice } from '@/state/device';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';
import { useKioskSession } from '@/state/session';
import { TENANT_TAX } from '@/tenant/tax';

/** A kiosk with a hung request and a queue behind it has to say something. */
const TIMEOUT_MS = 20_000;

/** Places the order before taking payment, so every authorization has an order. */
export default function ProcessingStep() {
  const { goNext, goTo } = useFlow();
  const { cart, reset: resetCheckout, setCommitted, tender, tipCents } = useKioskSession();
  const device = useDevice();
  const { guestLabel } = useGuest();
  const [ticket, setTicket] = useState<string | null>(null);
  const [blockedCode, setBlockedCode] = useState<string | null>(null);
  const [placementRejected, setPlacementRejected] = useState(false);
  const [priceIncrease, setPriceIncrease] = useState(false);
  const [terminalReplay, setTerminalReplay] = useState(false);
  const [recoveredPayment, setRecoveredPayment] = useState(false);
  const [state, dispatch] = useReducer(checkoutReducer, IDLE_CHECKOUT);
  const [runSequence, rerun] = useReducer((value: number) => value + 1, 0);
  const committedKey = useRef<string | null>(null);

  const totals = orderTotals({ subtotalCents: orderSubtotalCents(cart), tipCents, jurisdictions: TENANT_TAX });
  const [displayTotalCents, setDisplayTotalCents] = useState(totals.totalCents);
  const attempt = useRef({ cart, device, guestLabel, setCommitted, tender, tipCents, totalCents: totals.totalCents, state });
  attempt.current = { cart, device, guestLabel, setCommitted, tender, tipCents, totalCents: totals.totalCents, state };

  useEffect(() => {
    const snapshot = attempt.current;
    const preflight = checkoutPreflight(snapshot.tender, snapshot.device, deviceApiClient, {
      platform: Platform.OS,
      readerIsSimulated: CARD_READER_IS_SIMULATED,
      demoClient: demoSyncClient,
      demoLocationId: 'demo',
      forceDemo: demoSyncPreview,
    });
    if (preflight.kind === 'blocked') {
      // Nothing has been sent, so this remains a normal cancellable checkout.
      // Keeping this before both the key and `setCommitted(true)` is what
      // prevents a configuration error from trapping a guest on processing.
      snapshot.setCommitted(false);
      setBlockedCode(preflight.code);
      return undefined;
    }
    setBlockedCode(null);
    // Keep the key outside React state as well: development Strict Mode may
    // start an effect twice before the reducer's first `place` event renders.
    // Both requests must still hit the server under one key.
    const attemptKey = committedKey.current
      ?? checkoutAttemptKey(snapshot.state, newIdempotencyKey);
    committedKey.current = attemptKey;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Past this point the idle clock must never clear the session: a guest who
    // has paid and stepped back for a moment has not abandoned anything.
    snapshot.setCommitted(true);
    dispatch({ type: 'place', attemptKey });
    const controller = new AbortController();

    void (async () => {
      const placement = await placeCheckoutOrder(preflight.target, attemptKey, (locationId) =>
        toPlaceOrderRequest({
          cart: snapshot.cart,
          locationId,
          // The reader is the tender; the order is created first so a timeout
          // leaves a row to settle rather than an orphan charge.
          tenderType: preflight.tender.tenderType,
          tipCents: snapshot.tipCents,
          maximumTotalCents: snapshot.totalCents,
          guestLabel: snapshot.guestLabel,
        }));
      if (!active) return;
      if (placement.kind === 'ambiguous') {
        dispatch({ type: 'timedOut' });
        return;
      }
      if (placement.kind === 'failed') {
        // ApiError is a definite server rejection: no order was created. It is
        // therefore safe to unlock the kiosk and let the guest revise or end
        // this checkout. Ambiguous failures intentionally stay committed.
        snapshot.setCommitted(false);
        setPlacementRejected(true);
        dispatch({ type: 'failed', code: placement.code });
        return;
      }

      setPlacementRejected(false);
      const orderId = placement.kind === 'placed' ? placement.order.orderId : placement.orderId;
      const amountCents = paymentAmountCents(placement, snapshot.totalCents);
      setDisplayTotalCents(amountCents);
      if (placement.kind === 'placed') {
        setTicket(ticketCallout(placement.order.dailyNumber, snapshot.guestLabel));
      }
      dispatch({ type: 'placed', orderId });

      // A rolling deployment may briefly pair this client with an API that
      // predates maximumTotalCents. Never let that compatibility window turn
      // a stale menu into an unapproved higher card authorization.
      if (amountCents > snapshot.totalCents) {
        setPriceIncrease(true);
        dispatch({ type: 'failed', code: 'price_changed' });
        return;
      }

      const replay = preflight.target.kind === 'demo' && placement.kind === 'placed'
        ? demoReplayOutcome(placement.order.status)
        : 'continue';
      if (replay === 'terminal') {
        setTerminalReplay(true);
        dispatch({ type: 'failed', code: 'order_terminal' });
        return;
      }
      if (replay === 'already_authorized') {
        setRecoveredPayment(true);
        haptics.completed();
        dispatch({ type: 'authorized' });
        return;
      }

      if (!preflight.tender.requiresReader) {
        haptics.completed();
        dispatch({ type: 'authorized' });
        return;
      }

      timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const result = await authorize({ amountCents, orderId }, controller.signal);
      if (timer) clearTimeout(timer);
      if (!active) return;
      if (result.ok) {
        // Placement precedes card authorization. The shared demo follows the
        // same lifecycle, so Operator/Display see paid only after this succeeds.
        if (preflight.target.kind === 'demo' && demoSyncClient) {
          await demoSyncClient.transition(orderId, 'paid');
        }
        if (!active) return;
        haptics.completed();
        dispatch({ type: 'authorized' });
      } else if (result.code === 'cancelled') {
        dispatch({ type: 'timedOut' });
      } else {
        dispatch({ type: 'failed', code: result.code });
      }
    })().catch(() => {
      if (active) dispatch({ type: 'timedOut' });
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [runSequence]);

  const advice = recoveryAdvice(state);
  const done = state.phase === 'succeeded';

  return (
    <ProcessingView
      model={{
        advice, blocked: blockedCode !== null, displayTotalCents, done,
        originalTotalCents: totals.totalCents, placementRejected, priceIncrease,
        recoveredPayment, tender, terminalReplay, ticket,
      }}
      onBackToPayment={() => goTo('pay')}
      onClear={resetCheckout}
      onContinue={() => goNext({ placed: true })}
      onRetry={() => { dispatch({ type: 'retry' }); rerun(); }}
      onReviewOrder={() => goTo('bag')}
    />
  );
}
