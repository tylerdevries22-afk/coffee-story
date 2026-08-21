
import { CupIcon } from '@/components/rewards/cup-icon';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabState } from '@/lib/a11y-state';
import { useAppState, type ClientTab, type StaffTab } from '@/state/app-context';
import { CLIENT_TAB_LABELS } from '@/state/navigation-state';
import { colors, fonts, radius, shadow } from '@/theme/tokens';
import { AppIcon } from '@/components/icon';

/** SF Symbol names, plus the one mark the app draws itself. */
type NavIcon =
  | 'house' | 'calendar' | 'gift' | 'ellipsis' | 'sun.max' | 'person.2' | 'creditcard'
  | 'cup';

const CLIENT_ITEMS: readonly { key: ClientTab; label: string; icon: NavIcon }[] = [
  { key: 'home', label: CLIENT_TAB_LABELS.home, icon: 'house' },
  { key: 'gift', label: CLIENT_TAB_LABELS.gift, icon: 'gift' },
  { key: 'book', label: CLIENT_TAB_LABELS.book, icon: 'calendar' },
  { key: 'rewards', label: CLIENT_TAB_LABELS.rewards, icon: 'cup' },
  { key: 'more', label: CLIENT_TAB_LABELS.more, icon: 'ellipsis' },
];

const STAFF_ITEMS: readonly { key: StaffTab; label: string; icon: NavIcon }[] = [
  { key: 'today', label: 'Today', icon: 'sun.max' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'clients', label: 'Clients', icon: 'person.2' },
  { key: 'more', label: 'More', icon: 'ellipsis' },
];

export function BottomNav({
  staff = false,
  onQuickActions,
}: {
  staff?: boolean;
  /** Staff only: opens the quick-action menu from the centred plus. */
  onQuickActions?: () => void;
}) {
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
                <AppIcon name="plus" size={26} tintColor={colors.white} weight="semibold" />
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
          tintColor={colors.brand200}
          style={[StyleSheet.absoluteFill, styles.itemFill, styles.itemFillSelected, Platform.OS !== 'ios' && styles.webSelectedFallback]}
        />
      ) : null}
      <View style={styles.iconWrap}>
        {icon === 'cup' ? (
          <CupIcon size={22} color={colors.ink900} />
        ) : (
          <AppIcon name={icon} size={22} tintColor={colors.ink900} weight={selected ? 'semibold' : 'regular'} />
        )}
      </View>
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginHorizontal: 2,
    backgroundColor: colors.brand700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionPressed: { opacity: 0.85 },
  wrap: { position: 'absolute', left: 15, right: 15, height: 64, borderRadius: radius.pill, overflow: 'hidden', ...shadow.card },
  surface: { borderRadius: radius.pill },
  content: { flex: 1, padding: 4, flexDirection: 'row' },
  webGlassFallback: { backgroundColor: 'rgba(255,252,254,0.82)', borderWidth: 1, borderColor: colors.ink200 },
  item: { flex: 1, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', gap: 2 },
  itemFill: { borderRadius: radius.pill },
  itemFillSelected: { borderWidth: 1, borderColor: colors.brand200 },
  webSelectedFallback: { backgroundColor: colors.brand200 },
  iconWrap: { width: 28, height: 25, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 10 },
  labelSelected: { fontFamily: fonts.sansBold },
  pressed: { opacity: 0.68 },
});
