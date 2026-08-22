import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { AppIcon } from '@/components/icon';

export type SiriCommand = {
  key: string;
  phrase: string;
  onRun: () => void;
};

const COMMAND_DWELL_MS = 3400;

export function SiriAssistant({ commands, onClose }: { commands: readonly SiriCommand[]; onClose?: () => void }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const phase = useSharedValue(0);
  const spin = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return undefined;
    spin.value = withRepeat(withTiming(360, { duration: 14000, easing: Easing.linear }), -1);
    breathe.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    const timer = setInterval(() => setIndex((current) => (current + 1) % commands.length), COMMAND_DWELL_MS);
    return () => clearInterval(timer);
  }, [reducedMotion, commands.length, spin, breathe]);

  useEffect(() => {
    if (reducedMotion) return;
    phase.value = withSequence(
      withTiming(1, { duration: COMMAND_DWELL_MS * 0.4, easing: Easing.inOut(Easing.quad) }),
      withTiming(2, { duration: COMMAND_DWELL_MS * 0.35, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: COMMAND_DWELL_MS * 0.25, easing: Easing.inOut(Easing.quad) }),
    );
  }, [index, reducedMotion, phase]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${spin.value}deg` },
      { scale: 1 + breathe.value * 0.05 + phase.value * 0.04 },
    ],
  }));
  const blobAStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(phase.value, [0, 1, 2], [colors.siriCyan, colors.siriBlue, colors.siriPurple]),
    transform: [{ translateX: 5 + breathe.value * 2 }, { translateY: -4 }],
  }));
  const blobBStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(phase.value, [0, 1, 2], [colors.siriPurple, colors.siriPink, colors.siriCyan]),
    transform: [{ translateX: -6 }, { translateY: 3 + breathe.value * 2 }],
  }));
  const blobCStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(phase.value, [0, 1, 2], [colors.siriPink, colors.siriCyan, colors.siriBlue]),
    opacity: 0.75 + breathe.value * 0.25,
    transform: [{ translateX: 1 }, { translateY: 6 - breathe.value * 3 }],
  }));

  const command = commands[index];

  return (
    <View style={styles.card}>
      <View style={styles.orbHalo}>
        <Animated.View style={[styles.orb, orbStyle]}>
          <Animated.View style={[styles.blob, styles.blobA, blobAStyle]} />
          <Animated.View style={[styles.blob, styles.blobB, blobBStyle]} />
          <Animated.View style={[styles.blob, styles.blobC, blobCStyle]} />
        </Animated.View>
      </View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>Siri suggestions</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Run command: ${command.phrase}`}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            command.onRun();
          }}
          style={({ pressed }) => [styles.phraseRow, pressed && styles.pressed]}
        >
          {/* Plain Text: an Animated wrapper with a shared-value opacity left the
              phrase invisible on iOS (a11y tree had it, pixels didn't). Instant
              swap on index change instead; the orb carries the motion. */}
          <Text key={command.key} numberOfLines={1} style={styles.phrase}>
            “{command.phrase}”
          </Text>
          <AppIcon name="chevron.right" size={14} tintColor={colors.ink300} />
        </Pressable>
      </View>
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss Siri suggestions"
          hitSlop={8}
          onPress={() => {
            void Haptics.selectionAsync();
            onClose();
          }}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <AppIcon name="xmark" size={16} tintColor={colors.ink300} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Kept deliberately shallow: one line of phrase beside a small orb, so the
  // card reads as a hint strip rather than a feature panel.
  card: { minHeight: 56, borderRadius: radius.lg, paddingVertical: spacing.xs, paddingLeft: spacing.sm, paddingRight: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.ink900 },
  orbHalo: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  orb: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  blob: { position: 'absolute', width: 17, height: 17, borderRadius: 9, opacity: 0.9 },
  blobA: {},
  blobB: {},
  blobC: { width: 13, height: 13, borderRadius: 7 },
  copy: { flex: 1, gap: 1 },
  eyebrow: { color: colors.ink400, fontFamily: fonts.sansBold, fontSize: 9, letterSpacing: 1.1, textTransform: 'uppercase' },
  phraseRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  phrase: { flex: 1, color: colors.white, fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 17 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink700 },
  pressed: { opacity: 0.7 },
});
