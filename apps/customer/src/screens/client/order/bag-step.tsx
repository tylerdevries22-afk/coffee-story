/**
 * The bag, and the optional note that rides with the order.
 *
 * Both are pushed pages that cover the tab bar, so their last row clears the
 * sticky bar through `useStickyBarClearance` rather than `Screen`'s tab-bar
 * padding.
 */
import { Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import {
  ActionButton,
  RewardsBanner,
  StickyActionBar,
  useStickyBarClearance,
} from '@/components/order/order-chrome';
import { Body } from '@/components/ui';
import {
  describePickupWindow,
  formatMoney,
  fulfillmentDetail,
  fulfillmentLabel,
  type OrderCart,
  type OrderFulfillment,
} from '@platform/domain';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { BagLine, ContextRow } from './bag-step-rows';
import { createStyles } from './bag-step-styles';

export function BagStep({
  cart,
  fulfillment,
  windowValue,
  subtotalCents,
  pointsPerDollar,
  onBack,
  onEdit,
  onChangeQuantity,
  onCheckout,
}: {
  cart: OrderCart;
  fulfillment: OrderFulfillment;
  windowValue: string | null;
  subtotalCents: number;
  pointsPerDollar: number;
  onBack: () => void;
  onEdit: () => void;
  onChangeQuantity: (lineId: string, delta: number) => void;
  onCheckout: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const clearance = useStickyBarClearance();
  const window = windowValue ? describePickupWindow(windowValue, new Date()) : null;
  const empty = cart.lines.length === 0;

  return (
    <>
      <CollapsingScreen
        title="My Bag"
        onBack={onBack}
        backLabel="Menu"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <View style={styles.contextCard}>
          <ContextRow
            icon="clock"
            label={window ? `${window.dayLabel} · ${window.timeLabel}` : 'No time chosen'}
          />
          <View style={styles.contextDivider} />
          <ContextRow
            icon="mappin"
            label={fulfillmentLabel(fulfillment)}
            detail={fulfillmentDetail(fulfillment)}
            onEdit={onEdit}
          />
        </View>

        {empty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your bag is empty.</Text>
            <Body muted>Head back to the menu and add something warm.</Body>
          </View>
        ) : (
          <>
            {cart.lines.map((line) => (
              <BagLine
                key={line.id}
                line={line}
                onChangeQuantity={(delta) => onChangeQuantity(line.id, delta)}
              />
            ))}

            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{formatMoney(subtotalCents)}</Text>
            </View>

            <RewardsBanner
              label={`Earn ${pointsPerDollar} ${POINTS_LABEL} per $1 on this order`}
            />

            {cart.note ? (
              <View style={styles.noteEcho}>
                <AppIcon name="pencil" size={16} tintColor={tokens.primary} />
                <Text style={styles.noteEchoText}>{cart.note}</Text>
              </View>
            ) : null}
          </>
        )}
      </CollapsingScreen>
      <StickyActionBar>
        <ActionButton
          label="Checkout"
          value={empty ? undefined : formatMoney(subtotalCents)}
          disabled={empty}
          onPress={onCheckout}
        />
      </StickyActionBar>
    </>
  );
}

export { NoteStep } from './note-step';
