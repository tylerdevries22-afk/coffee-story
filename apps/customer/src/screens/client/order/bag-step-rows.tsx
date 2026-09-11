import { Pressable, Text, View } from 'react-native';

import { MenuImage } from '@/components/menu-image';
import { QuantityStepper } from '@/components/order/option-controls';
import {
  MAX_LINE_QUANTITY,
  formatMoney,
  orderLineTotalCents,
  type OrderLine,
} from '@platform/domain';
import { useCustomerCatalog } from '@/state/catalog-context';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './bag-step-styles';
import { findMenuItem } from './menu-data';

export function ContextRow({
  icon,
  label,
  detail,
  onEdit,
}: {
  icon: 'clock' | 'mappin';
  label: string;
  detail?: string;
  onEdit?: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.contextRow}>
      <AppIcon name={icon} size={16} tintColor={tokens.primary} />
      <View style={styles.contextCopy}>
        <Text style={styles.contextLabel}>{label}</Text>
        {detail ? <Text numberOfLines={1} style={styles.contextDetail}>{detail}</Text> : null}
      </View>
      {onEdit ? (
        // A Pressable, not a Text with onPress: react-native-web gives the
        // press responder keyboard activation, which a Text does not get, and
        // the label on its own was a 38x17pt target.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change when and where this order is going"
          hitSlop={8}
          onPress={onEdit}
          style={({ pressed }) => [styles.contextEditButton, pressed && styles.pressed]}
        >
          <Text style={styles.contextEdit}>Edit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export function BagLine({
  line,
  onChangeQuantity,
}: {
  line: OrderLine;
  onChangeQuantity: (delta: number) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { items } = useCustomerCatalog();
  const item = findMenuItem(items, line.itemId);
  return (
    <View style={styles.line}>
      <View style={styles.lineTop}>
        {item ? (
          <MenuImage source={item.image} variant="line" alt="" />
        ) : (
          <View style={styles.lineImage} />
        )}
        <View style={styles.lineCopy}>
          <Text style={styles.lineName}>{line.name}</Text>
          <Text style={styles.lineSummary}>{line.optionSummary}</Text>
        </View>
        <Text style={styles.lineUnit}>{formatMoney(line.unitPriceCents)}</Text>
      </View>
      <View style={styles.lineBottom}>
        <QuantityStepper
          quantity={line.quantity}
          max={MAX_LINE_QUANTITY}
          itemLabel={line.name}
          onDecrease={() => onChangeQuantity(-1)}
          onIncrease={() => onChangeQuantity(1)}
        />
        <Text style={styles.lineTotal}>{formatMoney(orderLineTotalCents(line))}</Text>
      </View>
    </View>
  );
}
