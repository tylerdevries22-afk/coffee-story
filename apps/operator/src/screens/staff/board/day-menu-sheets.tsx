import { useMemo } from 'react';
import {
  Pressable,
  Text,
  TextInput
} from 'react-native';

import { demoDrops } from '@/data/drops';
import { dropStatus, featuredDrop } from '@/features/drops';
import { endOfDaySummary } from '@/features/operator/eod';
import { useOperator } from '@/state/operator-store';
import { formatMoney } from '@platform/domain';
import { toggleState, useTokens as useBrandTokens } from '@platform/ui';

import { SettingToggle, SheetShell, StatRow } from './board-controls';
import { createStyles } from './board-styles';
export function DaySheet({ visible, onClose }: { visible: boolean; onClose: () => void; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const operator = useOperator();
  const summary = useMemo(() => endOfDaySummary(operator.orders.map((order) => ({
    status: order.status,
    totalCents: order.totalCents,
    tipCents: 0,
    lines: order.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
  }))), [operator.orders]);
  const drop = featuredDrop(demoDrops(), new Date());
  return (
    <SheetShell visible={visible} title="Today" onClose={onClose}>
      {drop ? (
        <StatRow
          label={`Drop: ${drop.title}`}
          value={dropStatus(drop, new Date()) === 'live' ? 'Live' : 'Upcoming'}
        />
      ) : null}
      <StatRow label="Orders" value={String(summary.ordersCompleted)} />
      <StatRow label="Revenue" value={formatMoney(summary.revenueCents)} />
      <StatRow label="Average order" value={formatMoney(summary.averageOrderCents)} />
      <StatRow label="Refunds" value={String(summary.refunds)} />
      <StatRow label="Cancellations" value={String(summary.cancellations)} />
      <Text style={styles.sheetSection}>Top items</Text>
      {summary.topItems.map((item) => (
        <StatRow key={item.name} label={item.name} value={`×${item.quantity}`} />
      ))}
    </SheetShell>
  );
}

export function MenuControlSheet({ visible, onClose }: { visible: boolean; onClose: () => void; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const operator = useOperator();
  return (
    <SheetShell visible={visible} title="Menu control" onClose={onClose}>
      <SettingToggle
        label="Pause ordering"
        detail="The app stops taking orders for this location until this is off"
        value={operator.orderingPaused}
        onToggle={() => operator.setOrderingPaused(!operator.orderingPaused)}
      />
      <Text style={styles.sheetSection}>Hours note</Text>
      <TextInput
        accessibilityLabel="Hours override note"
        value={operator.hoursOverride}
        onChangeText={operator.setHoursOverride}
        placeholder="Closing at 8 tonight — private event"
        placeholderTextColor={tokens.textMuted}
        style={styles.refundInput}
      />
      <Text style={styles.sheetSection}>86 board</Text>
      <Text style={styles.refundHint}>
        86&rsquo;d items stay on the menu marked sold out today and cannot be added
        to a bag. Everything resets at open.
      </Text>
      {operator.menuItems.length === 0 ? (
        <Text style={styles.refundHint}>
          This shop&rsquo;s menu has not loaded yet. Nothing can be 86&rsquo;d until it does.
        </Text>
      ) : null}
      {operator.menuItems.map((item) => {
        const is86d = operator.eightySixed.has(item.slug);
        return (
          <Pressable
            key={item.slug}
            accessibilityRole="switch"
            {...toggleState(is86d)}
            accessibilityLabel={`${item.name}. ${is86d ? '86’d — tap to restore' : 'Available — tap to 86'}`}
            onPress={() => operator.toggleEightySix(item.slug)}
            style={({ pressed }) => [styles.eightySixRow, pressed && styles.pressed]}
          >
            <Text style={[styles.locationName, is86d && styles.eightySixName]}>{item.name}</Text>
            <Text style={is86d ? styles.eightySixTag : styles.locationCurrent}>
              {is86d ? "86'd" : 'Available'}
            </Text>
          </Pressable>
        );
      })}
    </SheetShell>
  );
}
