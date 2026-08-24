import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { scrimOpacity, sheetOffset } from './sheet-presentation';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/**
 * A bottom sheet whose scrim fades while the sheet itself slides.
 *
 * React Native's `<Modal animationType="slide">` translates the *whole* modal
 * container, and on a `transparent` modal that container includes the dim
 * backdrop -- so the scrim swept up from the bottom edge with the sheet
 * instead of fading in place. `animationType="none"` hands the motion to us:
 * one `progress` value drives the scrim's opacity and the sheet's offset
 * together, so they can move on different curves without drifting apart.
 *
 * The tree stays mounted through the exit and unmounts on completion, so a
 * dismissal actually plays instead of the sheet vanishing on the first frame.
 *
 * Per the Fabric note in AGENTS.md, motion rides on these wrapper `View`s
 * only -- never on a `Text` inside `children`.
 */
export function SheetModal({
  visible,
  onRequestClose,
  dismissLabel,
  keyboardAvoiding = false,
  sheetStyle,
  children,
}: PropsWithChildren<{
  visible: boolean;
  onRequestClose: () => void;
  /**
   * Accessibility label for the tap-outside-to-close target. Omit to make the
   * scrim inert -- appropriate only when the sheet covers nearly the screen.
   */
  dismissLabel?: string;
  /** Lifts the sheet clear of the keyboard on iOS. For sheets with inputs. */
  keyboardAvoiding?: boolean;
  sheetStyle?: StyleProp<ViewStyle>;
}>) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const reducedMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  // 0 = fully dismissed, 1 = fully presented.
  const progress = useSharedValue(visible ? 1 : 0);
  // Over-estimated until the sheet reports its own height on layout. Both the
  // estimate and the real value put the sheet offscreen at progress 0, so the
  // correction is never a visible jump.
  const sheetHeight = useSharedValue(height);
  const [exited, setExited] = useState(!visible);

  // React's documented "adjust state when a prop changes" pattern. Re-arming
  // during render costs nothing (React re-runs this component before touching
  // the host tree) and it is what lets a *re*-open play its entrance: parking
  // this in the effect below would leave `exited` stale for one committed
  // frame, and unmount the sheet mid-entrance.
  if (visible && exited) setExited(false);

  const markExited = useCallback(() => setExited(true), []);

  useEffect(() => {
    if (visible) {
      progress.value = withTiming(1, {
        duration: reducedMotion ? 0 : tokens.motion.slow,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    progress.value = withTiming(
      0,
      { duration: reducedMotion ? 0 : tokens.motion.base, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(markExited)();
      },
    );
  }, [visible, reducedMotion, progress, markExited, tokens.motion.base, tokens.motion.slow]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity(progress.value, tokens.elevation.raised) }));
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetOffset(progress.value, sheetHeight.value) }],
  }));

  const layers = (
    <>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
      />
      {dismissLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          onPress={onRequestClose}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Animated.View
        accessibilityViewIsModal
        onLayout={(event) => {
          sheetHeight.value = event.nativeEvent.layout.height;
        }}
        style={[sheetStyle, slideStyle]}
      >
        {children}
      </Animated.View>
    </>
  );

  return (
    <Modal
      animationType="none"
      transparent
      // Held open through the exit so the dismissal has frames to play in.
      visible={visible || !exited}
      // Lets the scrim reach under the Android status bar instead of stopping
      // at a bright strip along the top.
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.root}
        >
          {layers}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.root}>{layers}</View>
      )}
    </Modal>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: tokens.textPrimary },
});
