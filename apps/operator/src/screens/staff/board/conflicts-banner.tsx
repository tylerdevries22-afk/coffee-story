import { Pressable, Text, View } from 'react-native';

import type { OperatorConflict } from '@/state/operator-conflicts';
import { useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './board-styles';

/**
 * A persistent, dismissable record of transitions the board could not
 * confirm -- a refund Square rejected, a queued advance the server
 * disagreed with. These used to be collected into state nothing rendered;
 * this puts them where the whole crew working the board can see one, not
 * only whoever had the order's sheet open when it failed.
 */
export function ConflictsBanner({
  conflicts,
  onDismiss,
}: {
  conflicts: readonly OperatorConflict[];
  onDismiss: (id: string) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  if (conflicts.length === 0) return null;
  return (
    <View style={styles.conflictBanner}>
      {conflicts.map((conflict) => (
        <View key={conflict.id} style={styles.conflictRow}>
          <Text accessibilityRole="alert" style={styles.conflictText}>{conflict.message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss this notice"
            onPress={() => onDismiss(conflict.id)}
            style={({ pressed }) => [styles.conflictDismiss, pressed && styles.pressed]}
          >
            <Text style={styles.conflictDismissText}>Dismiss</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
