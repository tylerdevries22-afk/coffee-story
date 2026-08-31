import { Fragment } from 'react';
import { Pressable, Text, View } from 'react-native';

import { paletteForTier } from '@/components/rewards/glass-cup-palettes';
import { hapticSelection } from './haptics';
import { useRewardStyles } from './styles';
import { type RewardTierName } from '@platform/domain';
import { TENANT_REWARD_TIERS } from '@/tenant';
import { choiceState, useTokens as useBrandTokens, AppIcon } from '@platform/ui';

/**
 * Demo-only tier switch. Overriding the year's points is what swaps the tier:
 * everything downstream — chip, palette, earn rate, Status progress — derives
 * from that one number, so the whole page moves together.
 */
export function DemoTierToggle({
  value,
  annualPoints,
  onChange,
}: {
  value: RewardTierName;
  annualPoints: number;
  onChange: (tier: RewardTierName) => void;
}) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  const safeAnnualPoints = Number.isFinite(annualPoints) ? Math.max(0, annualPoints) : 0;

  return (
    <View accessibilityLabel="Preview rewards tier" accessibilityRole="radiogroup" style={styles.demoTierBar}>
      <View style={styles.demoTierRow}>
        {TENANT_REWARD_TIERS.map((tier, index) => {
          const selected = tier.name === value;
          const palette = paletteForTier(tier.name, index);
          const percentage = tier.minimumAnnualPoints === 0
            ? 100
            : Math.min(100, Math.round((safeAnnualPoints / tier.minimumAnnualPoints) * 100));

          return (
            <Fragment key={tier.name}>
              <View style={styles.demoTierItem}>
                <Pressable
                  accessibilityRole="radio"
                  {...choiceState(selected)}
                  accessibilityLabel={`Preview ${tier.name} tier`}
                  onPress={() => {
                    hapticSelection();
                    onChange(tier.name);
                  }}
                  style={[
                    styles.demoTierChip,
                    selected ? { borderColor: palette.liquidMid } : styles.demoTierChipLocked,
                    selected && styles.demoTierChipSelected,
                  ]}
                >
                  <View style={styles.demoTierChipContent}>
                    {!selected ? <AppIcon name="lock.fill" size={10} tintColor={tokens.textMuted} /> : null}
                    <Text style={[styles.demoTierText, { color: selected ? palette.liquidDeep : tokens.textMuted }]}>
                      {tier.name}
                    </Text>
                  </View>
                </Pressable>
                <Text style={[styles.demoTierPercent, { color: selected ? palette.liquidMid : tokens.textMuted }]}>{percentage}%</Text>
              </View>
              {index < TENANT_REWARD_TIERS.length - 1 ? (
                <AppIcon name="chevron.right" size={13} tintColor={tokens.textMuted} style={styles.demoTierArrow} />
              ) : null}
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}
