import { Pressable, Text, View } from 'react-native';

import { ChipRow, WorkspaceCard } from '@/components/staff/workspace-ui';
import { AppIcon, type AppIconName } from '@/components/icon';
import { Button, Card } from '@/components/ui';
import { TIP_OPTIONS, type TipOption } from '@/features/staff/pos-totals';
import {
  isStaffTenderAvailable,
  type StaffTenderKey,
} from '@/features/staff/payment-availability';
import { formatMoney } from '@/features/staff/workspace';
import { colors } from '@/theme/tokens';
import type { PortalAppointment } from '@/types/domain';
import { styles } from './cart-section';

export type MethodKey = StaffTenderKey;

/**
 * The eight tenders the web Cash Register offers. `card` marks the tenders that
 * run through Stripe — everything else is recorded on the ticket by the staff
 * member who took it.
 */
export const METHODS: readonly { key: MethodKey; label: string; symbol: AppIconName; card: boolean }[] = [
  { key: 'card', label: 'Card', symbol: 'creditcard', card: true },
  { key: 'square', label: 'Square reader', symbol: 'square.grid.2x2', card: true },
  { key: 'tap', label: 'Tap to Pay', symbol: 'wave.3.right', card: true },
  { key: 'cash', label: 'Cash', symbol: 'banknote', card: false },
  { key: 'check', label: 'Check', symbol: 'doc.plaintext', card: false },
  { key: 'gift', label: 'Gift certificate', symbol: 'giftcard', card: false },
  { key: 'credit', label: 'Store credit', symbol: 'wallet.pass', card: false },
  { key: 'onfile', label: 'Card on file', symbol: 'creditcard.fill', card: true },
];

type MethodOption = (typeof METHODS)[number];

export function PaymentSection({
  selected,
  promptForTip,
  baseCents,
  totalCents,
  tipCents,
  extrasCents,
  tipOption,
  onTipChange,
  method,
  onMethodChange,
  chosenMethod,
  chosenMethodAvailable,
  isDemo,
  paying,
  onBack,
  onCollectPayment,
}: {
  selected: PortalAppointment | null;
  promptForTip: boolean;
  baseCents: number;
  totalCents: number;
  tipCents: number;
  extrasCents: number;
  tipOption: TipOption;
  onTipChange: (option: TipOption) => void;
  method: MethodKey | null;
  onMethodChange: (method: MethodKey) => void;
  chosenMethod: MethodOption | null;
  chosenMethodAvailable: boolean;
  isDemo: boolean;
  paying: boolean;
  onBack: () => void;
  onCollectPayment: () => void;
}) {
  return (
    <>
      <Card style={styles.amountCard}>
        <Text style={styles.amountEyebrow}>Amount due</Text>
        <Text style={styles.amountValue}>{formatMoney(totalCents)}</Text>
        <Text style={styles.amountSub}>
          {promptForTip ? `${formatMoney(baseCents)} + ${formatMoney(tipCents)} tip` : 'Gratuity is not requested for this checkout'}
        </Text>
        {selected && extrasCents > 0 ? (
          <Text style={styles.amountNote}>
            Card payment charges the visit balance and tip. Extra items are recorded on the ticket.
          </Text>
        ) : null}
      </Card>

      {promptForTip ? (
        <WorkspaceCard title="Add a tip">
          <ChipRow
            options={TIP_OPTIONS}
            value={tipOption}
            onChange={(next) => onTipChange(next ?? tipOption)}
          />
        </WorkspaceCard>
      ) : null}

      <WorkspaceCard title="Payment method">
        <View accessibilityRole="radiogroup" style={styles.grid}>
          {METHODS.map((option) => {
            const active = method === option.key;
            const available = isStaffTenderAvailable(option.key, isDemo);
            return (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityLabel={available ? option.label : `${option.label}, Demo only`}
                accessibilityState={{ checked: active, disabled: !available }}
                aria-checked={active}
                aria-disabled={!available}
                disabled={!available}
                onPress={() => onMethodChange(option.key)}
                style={({ pressed }) => [
                  styles.methodTile,
                  active && styles.methodTileActive,
                  !available && styles.methodTileDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <AppIcon name={option.symbol} size={20} tintColor={colors.brand600} />
                <Text style={[styles.methodLabel, active && styles.methodLabelActive]} numberOfLines={2}>
                  {option.label}
                </Text>
                {!available ? <Text style={styles.methodAvailability}>Demo only</Text> : null}
              </Pressable>
            );
          })}
        </View>
        {!isDemo ? (
          <Text style={styles.tenderNotice}>
            Only secure Card checkout is connected live. Reader, Tap to Pay, saved-card, and offline tenders remain available in Demo only.
          </Text>
        ) : null}
      </WorkspaceCard>

      <View style={styles.payActions}>
        <Button label="Back" variant="secondary" style={styles.backButton} onPress={onBack} />
        <Button
          label={chosenMethod && !chosenMethodAvailable
            ? 'Tender unavailable in live mode'
            : chosenMethod
              ? `Charge ${chosenMethod.label} · ${formatMoney(totalCents)}`
              : 'Select a payment method'}
          disabled={!chosenMethod || !chosenMethodAvailable}
          loading={paying}
          style={styles.chargeButton}
          onPress={onCollectPayment}
        />
      </View>
    </>
  );
}
