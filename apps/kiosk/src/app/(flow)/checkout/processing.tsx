import { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { newIdempotencyKey } from '@platform/api-client';
import { formatMoney, orderSubtotalCents, orderTotals, ticketCallout } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { CheckDraw } from '@/components/feedback/check-draw';
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

/**
 * Placing the order, then taking the money.
 *
 * That order matters: authorising first means a timeout can leave a charge with
 * no order behind it, which is the strictly worse failure -- an order with no
 * payment is a row a shop can see and settle, a payment with no order is a
 * refund nobody knows to make.
 *
 * Nothing here is cancellable. `backStep` already returns null for this step,
 * so the chrome hides its own chevron; this screen does not have to remember to.
 */
export default function ProcessingStep() {
  const tokens = useTokens();
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
    <View style={styles.root}>
      <Text style={[styles.total, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.mega }]}>
        {formatMoney(displayTotalCents)}
      </Text>

      {displayTotalCents < totals.totalCents ? (
        <Text accessibilityRole="alert" style={[styles.repriced, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
          Your total decreased to the current menu price.
        </Text>
      ) : null}

      {blockedCode !== null ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            Checkout is not ready on this kiosk. No order was sent and no payment was taken.
          </Text>
          <KioskPressable label="Back to payment" onPress={() => goTo('pay')} />
        </>
      ) : terminalReplay ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            This checkout was already cancelled or refunded. No new payment was taken.
          </Text>
          <KioskPressable label="Staff: clear checkout" onPress={resetCheckout} />
        </>
      ) : priceIncrease ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            The menu price changed. No payment was taken; please ask staff to clear this checkout.
          </Text>
          <KioskPressable label="Staff: clear checkout" onPress={resetCheckout} />
        </>
      ) : placementRejected ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            We could not place this order. No payment was taken.
          </Text>
          <KioskPressable label="Review order" onPress={() => goTo('bag')} />
        </>
      ) : done ? (
        <>
          <CheckDraw />
          <Text style={[styles.status, { color: tokens.success, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            {recoveredPayment
              ? 'Payment already confirmed'
              : (tender === 'cash' ? 'Order sent — pay at the counter' : 'Payment complete')}
          </Text>
          {ticket !== null ? (
            <>
              <Text style={[styles.status, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>
                Your order call-out
              </Text>
              {/* The number the DATABASE assigned, not one this screen invented.
                  `app.assign_daily_number` restarts it per location per service
                  date, which is what lets the board and the barista agree. */}
              <Text style={[styles.total, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.ticket }]}>
                {ticket}
              </Text>
            </>
          ) : null}
          <KioskPressable label="Continue" onPress={() => goNext({ placed: true })} />
        </>
      ) : advice === 'none' ? (
        <>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.status, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            {tender === 'cash' ? 'Sending your order…' : 'Taking your payment…'}
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            {advice === 'see-staff'
              ? 'Please speak to someone at the counter.'
              : advice === 'retry'
                ? 'We did not hear back. Nothing has been charged twice.'
                : 'That payment was declined.'}
          </Text>
          {advice === 'retry-payment' ? (
            <KioskPressable label="Try card again" onPress={() => { dispatch({ type: 'retry' }); rerun(); }} />
          ) : advice === 'retry' ? (
            <KioskPressable label="Try again" onPress={() => { dispatch({ type: 'retry' }); rerun(); }} />
          ) : advice === 'see-staff' ? (
            <KioskPressable label="Staff: clear checkout" onPress={resetCheckout} />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  total: {},
  repriced: { textAlign: 'center' },
  status: { textAlign: 'center', maxWidth: 720 },
});
