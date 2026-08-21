import { Text, View } from 'react-native';

import { AppIcon } from '@/components/icon';
import { Button, Card } from '@/components/ui';
import { formatMoney } from '@/features/staff/workspace';
import { colors } from '@/theme/tokens';

import { styles } from './cart-section';

/**
 * Receipt of what the register actually settled. Kept separate from the live
 * cart so the completion screen still reads correctly after the cart is reset,
 * and so `chargedCents` can differ from the cart total on the card path (the
 * server prices the visit, not the ticket).
 */
export type Receipt = {
  chargedCents: number;
  methodLabel: string;
  tipCents: number;
  extrasCents: number;
  providerCharged: boolean;
};

export function ReceiptSection({
  receipt,
  notice,
  onResetSale,
}: {
  receipt: Receipt;
  notice: string | null;
  onResetSale: () => void;
}) {
  return (
    <Card style={styles.completeCard}>
      <View style={styles.completeMark}>
        <AppIcon name="checkmark" size={26} tintColor={colors.white} />
      </View>
      <Text style={styles.completeTitle}>Purchase complete</Text>
      <Text style={styles.completeCopy}>
        {`${formatMoney(receipt.chargedCents)} ${receipt.providerCharged ? 'charged to' : 'recorded as'} ${receipt.methodLabel}`}
        {receipt.tipCents > 0 ? ` · ${formatMoney(receipt.tipCents)} tip` : ''}
      </Text>
      {receipt.extrasCents > 0 ? (
        <Text style={styles.completeNote}>
          {`${formatMoney(receipt.extrasCents)} of extra items was recorded on the ticket, not charged to the card.`}
        </Text>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={styles.completeNotice}>{notice}</Text> : null}
      <View style={styles.completeActions}>
        <Button label="Done" variant="secondary" style={styles.completeButton} onPress={onResetSale} />
        <Button label="New sale" style={styles.completeButton} onPress={onResetSale} />
      </View>
    </Card>
  );
}
