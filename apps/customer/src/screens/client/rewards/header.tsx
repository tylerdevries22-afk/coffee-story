import { BUSINESS } from '@/data/business';

import { Animated, Pressable, Text, View } from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { tabState, useTokens as useBrandTokens } from '@platform/ui';

import { RewardMark } from './reward-mark';
import { useRewardStyles } from './styles';

export const TABS = ['Redeem', 'Status', 'Earn', 'Cash'] as const;
export type RewardTab = (typeof TABS)[number];

export function RewardsHeader({
  compact,
  tierName,
  onHelp,
  scrollY,
}: {
  compact: boolean;
  tierName: string;
  onHelp: () => void;
  scrollY: Animated.Value;
}) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  return (
    <CollapsingPageHeader
      title="Rewards"
      scrollY={scrollY}
      backgroundColor={tokens.surface}
      actions={(
        <View style={[styles.headerActions, compact && styles.headerActionsCompact]}>
          <View style={[styles.tierChip, compact && styles.tierChipCompact]}>
            <Text style={[styles.tierChipText, compact && styles.tierChipTextCompact]}>{tierName}</Text>
            <RewardMark compact />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`How ${BUSINESS.name} rewards work`}
            hitSlop={8}
            onPress={onHelp}
            style={({ pressed }) => [styles.helpButton, compact && styles.helpButtonCompact, pressed && styles.pressed]}
          >
            <Text style={styles.helpText}>?</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

export function RewardTabs({
  compact,
  value,
  onChange,
}: {
  compact: boolean;
  value: RewardTab;
  onChange: (tab: RewardTab) => void;
}) {
  const styles = useRewardStyles();
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {TABS.map((tab) => (
        <Pressable
          key={tab}
          accessibilityRole="tab"
          {...tabState(tab === value)}
          onPress={() => onChange(tab)}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
        >
          <Text style={[styles.tabLabel, compact && styles.tabLabelCompact, tab === value && styles.tabLabelActive]}>{tab}</Text>
          {tab === value ? <View style={styles.tabIndicator} /> : null}
        </Pressable>
      ))}
    </View>
  );
}
