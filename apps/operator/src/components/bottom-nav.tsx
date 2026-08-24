
import { CupIcon } from '@/components/rewards/cup-icon';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabState } from '@platform/ui';
import { useAppState, type ClientTab, type StaffTab } from '@/state/app-context';
import { CLIENT_TAB_LABELS, STAFF_TAB_LABELS } from '@/state/navigation-state';
import { AppIcon } from '@/components/icon';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/** SF Symbol names, plus the one mark the app draws itself. */
type NavIcon =
  | 'house' | 'calendar' | 'gift' | 'ellipsis' | 'sun.max' | 'person.2' | 'creditcard'
  | 'cup' | 'rectangle.grid.2x2' | 'flame';

const CLIENT_ITEMS: readonly { key: ClientTab; label: string; icon: NavIcon }[] = [
  { key: 'home', label: CLIENT_TAB_LABELS.home, icon: 'house' },
  { key: 'gift', label: CLIENT_TAB_LABELS.gift, icon: 'gift' },
  { key: 'book', label: CLIENT_TAB_LABELS.book, icon: 'calendar' },
  { key: 'rewards', label: CLIENT_TAB_LABELS.rewards, icon: 'cup' },
  { key: 'more', label: CLIENT_TAB_LABELS.more, icon: 'ellipsis' },
];

/**
 * The web bar's own list.
 *
 * It has to be written out rather than derived, because each row carries an
 * icon the native UITabBar declares at its own trigger. That duplication is
 * exactly how this bar once shipped without an Orders tab at all
 * (docs/BUILD-REPORT.md), so a test now pins it to STAFF_TAB_ORDER.
 */
const STAFF_ITEMS: readonly { key: StaffTab; label: string; icon: NavIcon }[] = [
  { key: 'orders', label: STAFF_TAB_LABELS.orders, icon: 'rectangle.grid.2x2' },
  { key: 'prep', label: STAFF_TAB_LABELS.prep, icon: 'flame' },
  { key: 'crew', label: STAFF_TAB_LABELS.crew, icon: 'person.2' },
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
  const styles = createStyles(tokens);
  const insets = useSafeAreaInsets();
  const { clientTab, staffTab, setClientTab, setStaffTab } = useAppState();
  const items = staff ? STAFF_ITEMS : CLIENT_ITEMS;
  const active = staff ? staffTab : clientTab;

  function select(key: ClientTab | StaffTab) {
    if (staff) setStaffTab(key as StaffTab);
    else setClientTab(key as ClientTab);
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
}: {
  label: string;
  icon: NavIcon;
  selected: boolean;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      {...tabState(selected)}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      {selected ? (
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
          <AppIcon name={icon} size={22} tintColor={tokens.textPrimary} weight={selected ? 'semibold' : 'regular'} />
        )}
      </View>
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  quickAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginHorizontal: 2,
    backgroundColor: tokens.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionPressed: { opacity: 0.85 },
  wrap: { position: 'absolute', left: 15, right: 15, height: 64, borderRadius: tokens.radius.pill, overflow: 'hidden', shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5 },
  surface: { borderRadius: tokens.radius.pill },
  content: { flex: 1, padding: 4, flexDirection: 'row' },
  webGlassFallback: { backgroundColor: 'rgba(255,252,254,0.82)', borderWidth: 1, borderColor: tokens.secondary },
  item: { flex: 1, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', gap: 2 },
  itemFill: { borderRadius: tokens.radius.pill },
  itemFillSelected: { borderWidth: 1, borderColor: tokens.surface },
  webSelectedFallback: { backgroundColor: tokens.surface },
  iconWrap: { width: 28, height: 25, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center' },
  label: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 10 },
  labelSelected: { fontFamily: tokens.fontBody },
  pressed: { opacity: 0.68 },
});
