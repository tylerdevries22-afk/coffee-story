import { StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

/**
 * The question a step asks.
 *
 * Serif display voice, one per screen (docs/DESIGN.md: large display sizes are
 * earned by page-level moments only). A kiosk step that does not ask a question
 * is a kiosk step that has not decided what it is for.
 */
export function StepHeading({ title, hint }: { title: string; hint?: string }) {
  const tokens = useTokens();
  return (
    <View style={styles.wrap}>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.hero }]}
      >
        {title}
      </Text>
      {hint ? (
        <Text style={[styles.hint, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 8, gap: 6 },
  title: { textAlign: 'center' },
  hint: { textAlign: 'center' },
});
