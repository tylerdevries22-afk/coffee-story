import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { GIFT_AMOUNTS, GIFT_QUANTITIES, type GiftDesign } from '@/data/gift-designs';
import type { PaymentMethod } from '@platform/domain';
import { AppIcon, disabledState, useCopy, useTokens as useBrandTokens } from '@platform/ui';

import { CloseButton } from './gift-sheet-controls';
import { createGiftStyles } from './gift-shelves.styles';

/**
 * The purchase sheet: pick an amount and a quantity, then pay. Recipient details
 * are deliberately absent — cards land in the buyer's wallet and are sent from
 * there, which is what "buy now, send later" means.
 */
export function GiftCardSheet({
  design,
  amount,
  quantity,
  pointsPerDollar,
  paymentMethod,
  loading,
  onAmountChange,
  onQuantityChange,
  onPaymentMethodChange,
  onClose,
  onPay,
}: {
  design: GiftDesign;
  amount: number;
  quantity: number;
  pointsPerDollar: number;
  paymentMethod: PaymentMethod | null;
  loading: boolean;
  onAmountChange: (amount: number) => void;
  onQuantityChange: (quantity: number) => void;
  onPaymentMethodChange: () => void;
  onClose: () => void;
  onPay: () => void;
}) {
  const tokens = useBrandTokens();
  const copy = useCopy();
  const styles = createGiftStyles(tokens);
  const total = amount * quantity;
  return (
    <View style={styles.checkoutShell}>
      <Screen contentContainerStyle={styles.sheetContent}>
      <View style={styles.sheetHeader}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Digital Gift Card
        </Text>
        <CloseButton onPress={onClose} label="Close gift card" />
      </View>

      <Image source={design.art} style={styles.sheetHero} contentFit="cover" alt={design.name} />

      <Text accessibilityRole="header" style={styles.sheetHeading}>
        Buy now, send later!
      </Text>
      <Text style={styles.sheetBody}>
        Digital gift cards appear under the Gift tab, ready to share whenever you choose.
      </Text>

      <View style={styles.selectRow}>
        <Stepper
          label="Amount"
          value={`$${amount.toFixed(2)}`}
          accessibilityLabel={`Amount, ${amount} dollars`}
          onPress={() => onAmountChange(nextIn(GIFT_AMOUNTS, amount))}
        />
        <Stepper
          label="Quantity"
          value={String(quantity)}
          accessibilityLabel={`Quantity, ${quantity}`}
          onPress={() => onQuantityChange(nextIn(GIFT_QUANTITIES, quantity))}
        />
      </View>

      <View style={styles.divider} />

      <Text accessibilityRole="header" style={styles.sheetSection}>
        Payment Method
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paymentMethod ? `Card on file, ${paymentMethod.brand} ending in ${paymentMethod.last4}` : 'Card on file, no saved card'}
        onPress={onPaymentMethodChange}
        style={({ pressed }) => [styles.payMethod, pressed && styles.pressed]}
      >
        <View style={styles.payBadge}>
          <AppIcon name="creditcard" size={20} tintColor={tokens.textPrimary} />
        </View>
        <View style={styles.payCopy}>
          <Text style={styles.payName}>{paymentMethod ? `${paymentMethod.brand} •••• ${paymentMethod.last4}` : 'Card on file'}</Text>
          <Text style={styles.payMeta}>{paymentMethod ? `Expires ${paymentMethod.expirationMonth}/${paymentMethod.expirationYear}` : 'Add a card in Account settings'}</Text>
        </View>
        {paymentMethod ? <View style={styles.defaultChip}><Text style={styles.defaultChipText}>Default</Text></View> : null}
        <AppIcon name="chevron.right" size={15} tintColor={tokens.textMuted} />
      </Pressable>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <View style={styles.totalLeader} />
        <Text style={styles.totalValue}>${total.toFixed(2)}</Text>
      </View>

      <View style={styles.earnBanner}>
        <AppIcon name="heart.fill" size={18} tintColor={tokens.primary} />
        <Text style={styles.earnText}>
          {copy('earnBanner', {
            points: (total * pointsPerDollar).toLocaleString(),
            pointsName: copy('pointsName'),
          })}
        </Text>
      </View>

      <Text style={styles.finePrint}>Digital gift card sales are final and non-refundable.</Text>
      </Screen>
      <View style={styles.checkoutFooter}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Pay ${total} dollars with Apple Pay`}
          {...disabledState(loading)}
          disabled={loading}
          onPress={onPay}
          style={({ pressed }) => [styles.applePayButton, pressed && styles.pressed, loading && styles.payButtonBusy]}
        >
          <Text style={styles.applePayText}>{loading ? 'Processing…' : `Pay  $${total.toFixed(2)}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Cycles through the preset list, wrapping at the end. */
function nextIn(values: readonly number[], current: number): number {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? values[0] ?? current;
}

function Stepper({
  label,
  value,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  value: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  return (
    <View style={styles.selectGroup}>
      <Text style={styles.selectLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Cycles to the next option"
        onPress={onPress}
        style={({ pressed }) => [styles.select, pressed && styles.pressed]}
      >
        <Text style={styles.selectValue}>{value}</Text>
        <AppIcon name="chevron.down" size={14} tintColor={tokens.textMuted} />
      </Pressable>
    </View>
  );
}
