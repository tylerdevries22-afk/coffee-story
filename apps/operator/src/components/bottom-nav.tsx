
import { CupIcon } from '@/components/rewards/cup-icon';
import { createBottomNavStyles } from '@/components/bottom-nav-styles';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, tabState, useTokens as useBrandTokens } from '@platform/ui';
import { useAppState, type ClientTab, type StaffTab } from '@/state/app-context';
import { CLIENT_TAB_LABELS, STAFF_TAB_LABELS } from '@/state/navigation-state';
import { useOperations } from '@/state/operations-store';

/** SF Symbol names, plus the one mark the app draws itself. */
type NavIcon =
  | 'house' | 'calendar' | 'gift' | 'ellipsis' | 'sun.max' | 'person.2' | 'creditcard'
  | 'cup' | 'rectangle.grid.2x2' | 'flame' | 'book.closed';

const CLIENT_ITEMS: readonly { key: ClientTab; label: string; icon: NavIcon }[] = [
  { key: 'home', label: CLIENT_TAB_LABELS.home, icon: 'house' },
  { key: 'gift', label: CLIENT_TAB_LABELS.gift, icon: 'gift' },
  { key: 'book', label: CLIENT_TAB_LABELS.book, icon: 'calendar' },
  { key: 'rewards', label: CLIENT_TAB_LABELS.rewards, icon: 'cup' },
  { key: 'more', label: CLIENT_TAB_LABELS.more, icon: 'ellipsis' },
];

/**
 * Staff destinations pair navigation keys with their tenant-neutral icons.
 * A test pins this list to STAFF_TAB_ORDER so every route remains visible.
 */
const STAFF_ITEMS: readonly { key: StaffTab; label: string; icon: NavIcon }[] = [
  { key: 'orders', label: STAFF_TAB_LABELS.orders, icon: 'rectangle.grid.2x2' },
  { key: 'prep', label: STAFF_TAB_LABELS.prep, icon: 'flame' },
  { key: 'calendar', label: STAFF_TAB_LABELS.calendar, icon: 'calendar' },
  { key: 'training', label: STAFF_TAB_LABELS.training, icon: 'book.closed' },
  { key: 'more', label: STAFF_TAB_LABELS.more, icon: 'ellipsis' },
];

export function BottomNav({
  staff = false,
  onQuickActions,
}: {
  staff?: boolean;
  /** Staff only: opens the quick-action menu from the centred plus. */
  onQuickActions?: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createBottomNavStyles(tokens);
  const insets = useSafeAreaInsets();
  const { clientTab, staffTab, setClientTab, setStaffTab } = useAppState();
  // This bar renders for tenants with no operations installation, so it used to
  // reach for the nullable hook. `useOperations()` is the nullable hook now --
  // it answers the disabled board when no provider is mounted -- and an empty
  // badge falls out of an empty list rather than out of an optional chain.
  const operations = useOperations();
  const dueTaskCount = operations.occurrences.filter((task) => (
    !['completed', 'missed', 'cancelled'].includes(task.status)
    && Date.parse(task.scheduledFor) <= operations.now.getTime()
  )).length;
  const items = staff ? STAFF_ITEMS : CLIENT_ITEMS;
  const active = staff ? staffTab : clientTab;

  function select(key: ClientTab | StaffTab) {
    if (staff) setStaffTab(key as StaffTab);
    else setClientTab(key as ClientTab);
  }

  if (staff) {
    return (
      <View
        accessibilityRole="tablist"
        style={[styles.staffWrap, { paddingBottom: insets.bottom }]}
      >
        <View style={styles.staffContent}>
          {STAFF_ITEMS.map((item) => (
            <NavItem
              key={item.key}
              label={item.label}
              icon={item.icon}
              selected={active === item.key}
              onPress={() => select(item.key)}
              badge={item.key === 'calendar' ? dueTaskCount : 0}
              flat
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <GlassContainer
      accessibilityRole="tablist"
      spacing={4}
      style={[styles.wrap, Platform.OS !== 'ios' && styles.webGlassFallback, { bottom: Math.max(insets.bottom, 14) }]}
    >
      <GlassView
        pointerEvents="none"
        glassEffectStyle="regular"
        isInteractive={false}
        style={[StyleSheet.absoluteFill, styles.surface]}
      />
      <View style={styles.content}>
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {/* The plus sits in the middle of the row rather than floating over
                the content, so the four destinations stay evenly balanced. */}
            {onQuickActions && index === items.length / 2 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open quick actions"
                onPress={onQuickActions}
                style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}
              >
                <AppIcon name="plus" size={26} tintColor={tokens.surfaceElevated} weight="semibold" />
              </Pressable>
            ) : null}
            <NavItem label={item.label} icon={item.icon} selected={active === item.key} onPress={() => select(item.key)} />
          </Fragment>
        ))}
      </View>
    </GlassContainer>
  );
}

function NavItem({
  label,
  icon,
  selected,
  onPress,
  flat = false,
  badge = 0,
}: {
  label: string;
  icon: NavIcon;
  selected: boolean;
  onPress: () => void;
  flat?: boolean;
  badge?: number;
}) {
  const tokens = useBrandTokens();
  const styles = createBottomNavStyles(tokens);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      {...tabState(selected)}
      onPress={onPress}
      style={({ pressed }) => [styles.item, flat && styles.staffItem, pressed && styles.pressed]}
    >
      {selected && !flat ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle={{ style: 'regular', animate: true, animationDuration: 0.22 }}
          isInteractive
          tintColor={tokens.surface}
          style={[StyleSheet.absoluteFill, styles.itemFill, styles.itemFillSelected, Platform.OS !== 'ios' && styles.webSelectedFallback]}
        />
      ) : null}
      <View style={styles.iconWrap}>
        {icon === 'cup' ? (
          <CupIcon size={22} color={tokens.textPrimary} />
        ) : (
          <AppIcon
            name={icon}
            size={22}
            tintColor={selected || !flat ? tokens.textPrimary : tokens.textMuted}
            weight={selected ? 'semibold' : 'regular'}
          />
        )}
        {badge > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{Math.min(9, badge)}</Text></View> : null}
      </View>
      <Text style={[styles.label, flat && styles.staffLabel, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}
