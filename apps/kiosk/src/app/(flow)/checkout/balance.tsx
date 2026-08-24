import { StyleSheet, Text, View } from 'react-native';

import { coverageFor, formatMoney, orderSubtotalCents, orderTotals } from '@platform/domain';
import { useCopy, useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';
import { lookupBalance } from '@/lib/identify';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';
import { useKioskSession } from '@/state/session';
import { TENANT_TAX } from '@/tenant/tax';

/**
 * What the guest's balance covers, and what is left to pay.
 *
 * The arithmetic is stated on screen in the order the server applies it --
 * balance first, remainder second -- because PRODUCT-MECHANICS records that a
 * later move to opaque tiering drew public criticism for quietly devaluing
 * rewards. A guest should be able to check this against their own maths.
 *
 * Nothing here is a Supabase read: a kiosk device token deliberately cannot see
 * `customers` or `loyalty_accounts` (FIVE-SURFACES' device table), so the
 * lookup is a narrow server projection. `lib/identify.ts` is that seam.
 */
export default function BalanceStep() {
  const tokens = useTokens();
  const copy = useCopy();
  const { goNext } = useFlow();
  const { maskedPhone } = useGuest();
  const { cart } = useKioskSession();

  const totals = orderTotals({ subtotalCents: orderSubtotalCents(cart), jurisdictions: TENANT_TAX });
  const account = lookupBalance(maskedPhone);
  const { coveredCents, remainderCents } = coverageFor(totals.totalCents, account.balanceCents);

  return (
    <View style={styles.root}>
      <StepHeading
        title={account.firstName ? `Welcome back, ${account.firstName}` : 'Your balance'}
        hint={maskedPhone ?? undefined}
      />

      <View style={[styles.card, { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg }]}>
        <Row label={`${copy('pointsName')} balance`} value={formatMoney(account.balanceCents)} />
        <Row label="Order total" value={formatMoney(totals.totalCents)} />
        <View style={[styles.divider, { backgroundColor: `${tokens.textMuted}33` }]} />
        <Row label="Applied from balance" value={`− ${formatMoney(coveredCents)}`} accent />
        <Row label="Left to pay" value={formatMoney(remainderCents)} strong />
      </View>

      <KioskPressable
        label={remainderCents === 0 ? 'Pay with my balance' : 'Pay the rest by card'}
        trailing={remainderCents === 0 ? undefined : formatMoney(remainderCents)}
        onPress={() => goNext()}
      />
    </View>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  const tokens = useTokens();
  const size = strong ? tokens.type.xxl : tokens.type.lg;
  return (
    <View style={styles.row}>
      <Text style={{ color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: size }}>{label}</Text>
      <Text style={{
        color: accent ? tokens.accent : tokens.textPrimary,
        fontFamily: tokens.fontBody, fontSize: size, fontWeight: strong ? '700' : '600',
      }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 32, gap: 28 },
  card: { width: 620, padding: 28, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, marginVertical: 4 },
});
