import { Modal, StyleSheet, Text, View } from 'react-native';

import type { KioskUtility } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { utilityContentFor } from '@/features/utility-content';

/** A full-screen, dismissible explanation for a configured kiosk utility. */
export function KioskUtilityPanel({
  utility,
  onClose,
}: {
  utility: KioskUtility;
  onClose: () => void;
}) {
  const tokens = useTokens();
  const content = utilityContentFor(utility);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      visible
    >
      <View
        accessibilityLabel={`${content.label} information`}
        accessibilityViewIsModal
        style={[styles.root, { backgroundColor: tokens.surface }]}
        testID="kiosk-utility-panel"
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: tokens.surfaceElevated,
              borderColor: `${tokens.textMuted}44`,
              borderRadius: tokens.radius.lg,
            },
          ]}
        >
          <Text
            style={[styles.eyebrow, { color: tokens.accent, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}
          >
            {content.label}
          </Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.hero }]}
          >
            {content.title}
          </Text>
          <Text
            style={[styles.message, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}
          >
            {content.message}
          </Text>
          <KioskPressable label="Back to ordering" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  card: {
    width: '100%', maxWidth: 760, alignItems: 'center', gap: 24,
    borderWidth: 2, paddingHorizontal: 56, paddingVertical: 48,
  },
  eyebrow: { fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { textAlign: 'center' },
  message: { maxWidth: 640, textAlign: 'center', lineHeight: 34 },
});
