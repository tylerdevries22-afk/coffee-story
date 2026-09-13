import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTokens as useBrandTokens } from '@platform/ui';

import type { ActionRequestState } from './action-request-state';
import { createStyles } from './board-styles';

/**
 * The order detail sheet's footer while a cancel/refund is pending or has
 * failed. Rendered instead of closing the sheet, so a rejected refund shows
 * up where the barista is already looking rather than in a channel nothing
 * reads.
 */
export function OrderDetailStatus({
  state,
  onRetry,
  onDismiss,
}: {
  state: ActionRequestState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  if (state.phase === 'pending') {
    return (
      <View accessibilityRole="alert" style={styles.detailStatusRow}>
        <ActivityIndicator color={tokens.textMuted} />
        <Text style={styles.detailStatusText}>
          {state.kind === 'refund' ? 'Sending the refund…' : 'Cancelling the order…'}
        </Text>
      </View>
    );
  }
  if (state.phase === 'error') {
    return (
      <View style={styles.detailErrorBox}>
        <Text accessibilityRole="alert" style={styles.detailErrorText}>{state.message}</Text>
        <View style={styles.detailDangerRow}>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.detailQuiet, pressed && styles.pressed]}
          >
            <Text style={styles.detailQuietText}>Dismiss</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.detailDanger, pressed && styles.pressed]}
          >
            <Text style={styles.detailDangerText}>Retry {state.kind === 'refund' ? 'refund' : 'cancel'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return null;
}
