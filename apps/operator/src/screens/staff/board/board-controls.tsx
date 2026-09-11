import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toggleState, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './board-styles';

export function HeaderButton({ label, onPress }: { label: string; onPress: () => void; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <Text style={styles.headerButtonText}>{label}</Text>
    </Pressable>
  );
}
export function SheetShell({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetWidth = Math.min(640, Math.max(0, width - tokens.spacing.xl * 2));
  const sheetInset = Math.max(tokens.spacing.xl, (width - sheetWidth) / 2);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.backdrop} />
      <View style={[styles.sheet, {
        left: sheetInset,
        right: sheetInset,
        paddingBottom: Math.max(tokens.spacing.xl, insets.bottom + tokens.spacing.xl),
      }]}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
        <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
      </View>
    </Modal>
  );
}
export function StatRow({ label, value }: { label: string; value: string; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function SettingToggle({
  label,
  detail,
  value,
  onToggle,
}: {
  label: string;
  detail: string;
  value: boolean;
  onToggle: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="switch"
      {...toggleState(value)}
      accessibilityLabel={`${label}. ${detail}`}
      onPress={onToggle}
      style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
    >
      <View style={styles.settingCopy}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
      </View>
    </Pressable>
  );
}
