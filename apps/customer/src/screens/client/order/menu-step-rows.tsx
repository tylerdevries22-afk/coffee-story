import { Pressable, Text, View } from 'react-native';

import { MenuImage } from '@/components/menu-image';
import { Ribbon } from '@/components/order/order-chrome';
import type { MenuItem } from '@/data/catalog';
import { menuPriceLabel } from '@platform/domain';
import { AppIcon, disabledState, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './menu-step-styles';

export function ContextPill({
  icon,
  label,
  detail,
  action,
  onPress,
}: {
  icon: 'clock' | 'mappin';
  label: string;
  detail?: string;
  action?: string;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}. Change` : `${label}. Change`}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <AppIcon name={icon} size={16} tintColor={tokens.primary} />
      <Text numberOfLines={1} style={styles.pillLabel}>
        {label}
        {detail ? <Text style={styles.pillDetail}>{`  ${detail}`}</Text> : null}
      </Text>
      <Text style={styles.pillAction}>{action ?? 'Change'}</Text>
    </Pressable>
  );
}

export function MenuRow({
  item,
  orderingPaused,
  highlighted,
  onPress,
}: {
  item: MenuItem;
  orderingPaused: boolean;
  highlighted: boolean;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const price = menuPriceLabel(item.sizes);
  const soldOut = Boolean(item.soldOutToday);
  const unavailable = soldOut || orderingPaused;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={soldOut
        ? `${item.name}, sold out today`
        : orderingPaused
          ? `${item.name}, ordering is temporarily paused`
          : `${item.name}, ${price}. ${item.description}`}
      {...disabledState(unavailable)}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [styles.row, highlighted && styles.rowHighlighted, pressed && styles.pressed, soldOut && styles.rowSoldOut]}
    >
      <MenuImage source={item.image} variant="row" alt="" />
      <View style={styles.rowCopy}>
        {soldOut ? <Ribbon label="Sold out today" tone="danger" /> : null}
        {highlighted && !soldOut ? <Ribbon label="From your tap" tone="quiet" /> : null}
        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowPrice}>{price}</Text>
        <Text numberOfLines={2} style={styles.rowDescription}>{item.description}</Text>
      </View>
      <AppIcon name="chevron.right" size={16} tintColor={tokens.textMuted} />
    </Pressable>
  );
}
