import { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { formatMoney, orderSubtotalCents, orderTotals, ticketCallout } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { CheckDraw } from '@/components/feedback/check-draw';
import { IDLE_CHECKOUT, checkoutReducer, recoveryAdvice } from '@/features/checkout';
import { toPlaceOrderRequest } from '@/features/order-request';
import { deviceApiClient } from '@/lib/api';
import { authorize } from '@/lib/card-reader';
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
  const { cart, setCommitted } = useKioskSession();
  const device = useDevice();
  const { guestLabel } = useGuest();
  const [ticket, setTicket] = useState<string | null>(null);
  const [state, dispatch] = useReducer(checkoutReducer, IDLE_CHECKOUT);
  const started = useRef(false);

  const totals = orderTotals({ subtotalCents: orderSubtotalCents(cart), jurisdictions: TENANT_TAX });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Past this point the idle clock must never clear the session: a guest who
    // has paid and stepped back for a moment has not abandoned anything.
    setCommitted(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    void (async () => {
      const attemptKey = newAttemptKey();
      dispatch({ type: 'place', attemptKey });

      /**
       * A paired kiosk places a REAL order; an unpaired one runs the demo
       * plane. The branch is on the device rather than on a build flag, so the
       * same binary is a working till in a shop and a walkable demo on the web
       * export the captures use.
       */
      let orderId = attemptKey;
      const api = device.accessToken ? deviceApiClient(device.accessToken) : null;
      if (api && device.locationId) {
        try {
          const placed = await api.placeOrder(
            toPlaceOrderRequest({
              cart,
              locationId: device.locationId,
              // The reader is the tender; the order is created first so a
              // timeout leaves a row to settle rather than an orphan charge.
              tenderType: 'pay_at_pickup',
              guestLabel,
            }),
            // The SAME key the reducer is holding, so a retry of a request that
            // may already have created an order returns that order rather than
            // making a second one.
            attemptKey,
          );
          orderId = placed.orderId;
          setTicket(ticketCallout(placed.dailyNumber, guestLabel));
        } catch {
          clearTimeout(timer);
          dispatch({ type: 'failed', code: 'order_rejected' });
          return;
        }
      }
      dispatch({ type: 'placed', orderId });

      const result = await authorize({ amountCents: totals.totalCents, orderId }, controller.signal);
      clearTimeout(timer);
      if (result.ok) {
        haptics.completed();
        dispatch({ type: 'authorized' });
      } else if (result.code === 'cancelled') {
        dispatch({ type: 'timedOut' });
      } else {
        dispatch({ type: 'failed', code: result.code });
      }
    })();

    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.totalCents, setCommitted]);

  const advice = recoveryAdvice(state);
  const done = state.phase === 'succeeded';

  return (
    <View style={styles.root}>
      <Text style={[styles.total, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.mega }]}>
        {formatMoney(totals.totalCents)}
      </Text>

      {done ? (
        <>
          <CheckDraw />
          <Text style={[styles.status, { color: tokens.success, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            Payment complete
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
            Taking your payment…
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
          {advice === 'choose-another-tender' ? (
            <KioskPressable label="Try another way to pay" onPress={() => { dispatch({ type: 'retry' }); goTo('pay'); }} />
          ) : advice === 'retry' ? (
            <KioskPressable label="Try again" onPress={() => { started.current = false; dispatch({ type: 'retry' }); }} />
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * A UUID per attempt, which becomes `orders.client_key`.
 *
 * `crypto.randomUUID` is not on Hermes, so this falls back rather than throwing
 * on the one device class the kiosk actually runs on.
 */
function newAttemptKey(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof globalCrypto?.randomUUID === 'function') return globalCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  total: {},
  status: { textAlign: 'center', maxWidth: 720 },
});
