import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { GlassCup } from '@/components/rewards/glass-cup';
import type { RewardTierName } from '@platform/domain';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { useRewardStyles } from '../styles';

export function ProgressHalo({ progress, reducedMotion, tier }: { progress: number; reducedMotion: boolean; tier: RewardTierName }) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  const { width } = useWindowDimensions();
  const size = Math.min(310, width - 86);
  const center = size / 2;
  const radiusValue = size / 2 - 13;
  const segments = 34;
  const [animation] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) {
      animation.setValue(1);
      return;
    }
    Animated.timing(animation, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, [animation, reducedMotion]);

  return (
    <View accessibilityLabel={`${Math.round(progress * 100)} percent toward the next rewards status`} style={{ width: size, height: size * 0.82 }}>
      {Array.from({ length: segments }, (_, index) => {
        const angle = -150 + (300 / (segments - 1)) * index;
        const radians = (angle * Math.PI) / 180;
        const active = index / (segments - 1) <= progress;
        return (
          <Animated.View
            key={angle}
            style={[
              styles.haloSegment,
              {
                left: center + Math.cos(radians) * radiusValue - 3,
                top: center + Math.sin(radians) * radiusValue - 9,
                backgroundColor: active ? tokens.accent : tokens.secondary,
                opacity: animation,
                transform: [
                  { rotate: `${angle + 90}deg` },
                  { scaleY: animation },
                ],
              },
            ]}
          />
        );
      })}
      <View style={[styles.haloCenter, { left: center - 70, top: center - 70 }]}>
        <GlassCup
          size={110}
          fillPercent={1}
          tier={tier}
          replayKey={tier}
          accessibilityLabel={`${tier} status cup`}
        />
      </View>
    </View>
  );
}

export function PerkRow({ label, locked, onPress }: { label: string; locked: boolean; onPress: () => void }) {
  const styles = useRewardStyles();
  const tokens = useBrandTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${locked ? 'Locked' : 'Unlocked'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.perkRow, pressed && styles.rowPressed]}
    >
      <View style={[styles.perkIcon, locked && styles.perkIconLocked]}>
        <Text style={styles.perkIconText}>{locked ? '♕' : '✦'}</Text>
      </View>
      <Text style={styles.perkLabel}>{label}</Text>
      <AppIcon name="chevron.right" size={17} tintColor={tokens.textMuted} />
    </Pressable>
  );
}
