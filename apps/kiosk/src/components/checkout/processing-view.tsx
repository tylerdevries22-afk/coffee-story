import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { formatMoney } from '@platform/domain';
import type { KioskTender } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { CheckDraw } from '@/components/feedback/check-draw';
import type { CheckoutAdvice } from '@/features/checkout';

export type ProcessingViewModel = {
  advice: CheckoutAdvice;
  blocked: boolean;
  displayTotalCents: number;
  done: boolean;
  originalTotalCents: number;
  placementRejected: boolean;
  priceIncrease: boolean;
  recoveredPayment: boolean;
  tender: KioskTender | null;
  terminalReplay: boolean;
  ticket: string | null;
};

type ProcessingViewProps = {
  model: ProcessingViewModel;
  onBackToPayment: () => void;
  onClear: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onReviewOrder: () => void;
};

export function ProcessingView({
  model,
  onBackToPayment,
  onClear,
  onContinue,
  onRetry,
  onReviewOrder,
}: ProcessingViewProps) {
  const tokens = useTokens();
  const {
    advice, blocked, displayTotalCents, done, originalTotalCents,
    placementRejected, priceIncrease, recoveredPayment, tender, terminalReplay, ticket,
  } = model;

  return (
    <View style={styles.root}>
      <Text style={[styles.total, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.mega }]}>
        {formatMoney(displayTotalCents)}
      </Text>

      {displayTotalCents < originalTotalCents ? (
        <Text accessibilityRole="alert" style={[styles.repriced, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
          Your total decreased to the current menu price.
        </Text>
      ) : null}

      {blocked ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            Checkout is not ready on this kiosk. No order was sent and no payment was taken.
          </Text>
          <KioskPressable label="Back to payment" onPress={onBackToPayment} />
        </>
      ) : terminalReplay ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            This checkout was already cancelled or refunded. No new payment was taken.
          </Text>
          <KioskPressable label="Staff: clear checkout" onPress={onClear} />
        </>
      ) : priceIncrease ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            The menu price changed. No payment was taken; please ask staff to clear this checkout.
          </Text>
          <KioskPressable label="Staff: clear checkout" onPress={onClear} />
        </>
      ) : placementRejected ? (
        <>
          <Text accessibilityRole="alert" style={[styles.status, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
            We could not place this order. No payment was taken.
          </Text>
          <KioskPressable label="Review order" onPress={onReviewOrder} />
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
              {/* This is the database-assigned daily number used by the board. */}
              <Text style={[styles.total, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.ticket }]}>
                {ticket}
              </Text>
            </>
          ) : null}
          <KioskPressable label="Continue" onPress={onContinue} />
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
            <KioskPressable label="Try card again" onPress={onRetry} />
          ) : advice === 'retry' ? (
            <KioskPressable label="Try again" onPress={onRetry} />
          ) : advice === 'see-staff' ? (
            <KioskPressable label="Staff: clear checkout" onPress={onClear} />
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
