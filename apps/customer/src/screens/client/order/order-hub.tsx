import * as Haptics from 'expo-haptics';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body } from '@/components/ui';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { useBusiness } from '@/state/business';
import { tenantFeature } from '@/tenant';
import type { FulfillmentMode } from '@platform/domain';
import { AppIcon, choiceState, useTokens as useBrandTokens } from '@platform/ui';

import { DispatchIllustration, ShopIllustration } from './order-illustrations';
import { createStyles } from './order-styles';
export function OrderHub({
  mode,
  onStart,
  onOpenGift,
  onOpenCatering,
  onOpenRewards,
  pointsPerDollar,
}: {
  mode: FulfillmentMode | null;
  onStart: (mode: FulfillmentMode) => void;
  onOpenGift: () => void;
  onOpenCatering: () => void;
  onOpenRewards: () => void;
  pointsPerDollar: number;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const business = useBusiness();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  // Rule 5: these three are brand flags, and the hub offered all three to
  // everyone. A shop with delivery off still showed a Delivery card that
  // started a flow it cannot fulfil, and one without stored value still
  // offered gift cards -- the balance was already gated, the entry point
  // was not. Delivery is now off for the launch tenant too, so this card is
  // what removes the offer rather than letting a guest build a cart the
  // place-order tap would refuse.
  const deliveryEnabled = tenantFeature('delivery');

  return (
    <CollapsingScreen
      title="Start an Order"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      headerBackgroundColor={tokens.surface}
      headerBorderColor={tokens.surface}
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}
    >
      <View accessibilityRole="radiogroup" style={[styles.modeRow, compact && styles.modeRowCompact]}>
        {deliveryEnabled ? (
          <ModeCard
            mode="delivery"
            label="Delivery"
            compact={compact}
            selected={mode === 'delivery'}
            onPress={() => onStart('delivery')}
          />
        ) : null}
        <ModeCard
          mode="pickup"
          label="Pickup"
          compact={compact}
          selected={mode === 'pickup'}
          onPress={() => onStart('pickup')}
        />
      </View>

      {tenantFeature('catering') ? (
        <HubRow
          icon="person.2"
          title="Catering"
          detail="Service for your event — message the team"
          onPress={onOpenCatering}
        />
      ) : null}
      {tenantFeature('stored_value') ? (
        <HubRow
          icon="giftcard"
          title="Digital Gift Cards"
          detail="Send a blessing in a few taps."
          onPress={onOpenGift}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rewards. Earn ${pointsPerDollar} ${POINTS_LABEL} for every dollar on every order.`}
        onPress={onOpenRewards}
        style={({ pressed }) => [styles.promo, pressed && styles.cardPressed]}
      >
        <View style={styles.promoCopy}>
          <Text style={styles.promoTitle}>Every order counts</Text>
          <Text style={styles.promoDetail}>
            Earn {pointsPerDollar} {POINTS_LABEL} for every $1 you spend, then trade them for the
            next one.
          </Text>
        </View>
        <View style={styles.promoMark}>
          <AppIcon name="star.fill" size={28} tintColor={tokens.primary} />
        </View>
      </Pressable>

      <Body muted>
        Pickup at {business.street}{deliveryEnabled ? ', or delivery to your door' : ''}.
      </Body>
    </CollapsingScreen>
  );
}

function HubRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: 'person.2' | 'giftcard';
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [styles.hubRow, pressed && styles.cardPressed]}
    >
      <View style={styles.hubIcon}>
        <AppIcon name={icon} size={22} tintColor={tokens.primary} />
      </View>
      <View style={styles.hubCopy}>
        <Text style={styles.hubTitle}>{title}</Text>
        <Text style={styles.hubDetail}>{detail}</Text>
      </View>
      <AppIcon name="chevron.right" size={18} tintColor={tokens.textMuted} />
    </Pressable>
  );
}

type ModeCardProps = {
  mode: FulfillmentMode;
  label: string;
  compact: boolean;
  selected: boolean;
  onPress: () => void;
};

function ModeCard({ mode, label, compact, selected, onPress }: ModeCardProps) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} order`}
      {...choiceState(selected)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeCard,
        compact && styles.modeCardCompact,
        selected && styles.modeCardSelected,
        pressed && styles.cardPressed,
      ]}
    >
      {mode === 'delivery'
        ? <DispatchIllustration active={selected} compact={compact} />
        : <ShopIllustration active={selected} compact={compact} />}
      <Text style={[styles.modeLabel, compact && styles.modeLabelCompact]}>{label}</Text>
    </Pressable>
  );
}
