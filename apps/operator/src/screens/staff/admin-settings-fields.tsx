import { Pressable, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import type { AdminSettingsState } from '@/features/admin/admin-settings';
import { useTokens as useBrandTokens } from '@platform/ui';
import { createStyles } from './admin-settings-styles';

export function BusinessInfoPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.panel}>
      <PanelHeading title="Business information" detail="This identity appears on receipts and client communication." />
      <Field label="Business name" value={value.businessName} editable={isDemo} onChangeText={(businessName) => onChange({ ...value, businessName })} />
      <Field label="Business email" value={value.businessEmail} editable={isDemo} keyboardType="email-address" onChangeText={(businessEmail) => onChange({ ...value, businessEmail })} />
      <Field label="Business phone" value={value.businessPhone} editable={isDemo} keyboardType="phone-pad" onChangeText={(businessPhone) => onChange({ ...value, businessPhone })} />
      <Field label="Shop address" value={value.businessAddress} editable={isDemo} multiline onChangeText={(businessAddress) => onChange({ ...value, businessAddress })} />
    </View>
  );
}

type SettingsPanelProps = {
  value: AdminSettingsState;
  onChange: (settings: AdminSettingsState) => void;
};

export function PanelHeading({ title, detail }: { title: string; detail: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return <View style={styles.heading}><Text style={styles.panelTitle}>{title}</Text><Text style={styles.panelDetail}>{detail}</Text></View>;
}

export function ToggleRow({ label, detail, value, disabled = false, onChange }: { label: string; detail: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={[styles.toggleRow, disabled && styles.controlDisabled]}>
      <View style={styles.flex}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
      <Switch accessibilityLabel={label} disabled={disabled} value={value} onValueChange={onChange} trackColor={{ false: tokens.secondary, true: tokens.secondary }} thumbColor={tokens.surfaceElevated} />
    </View>
  );
}

export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <Field label={label} value={String(value)} keyboardType="number-pad" onChangeText={(next) => onChange(Number(next.replace(/\D/g, '')) || 0)} />;
}

export function Field({
  label,
  keyboardType,
  editable = true,
  multiline,
  value,
  onChangeText,
}: {
  label: string;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
  multiline?: boolean;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline, !editable && styles.controlDisabled]}
      />
    </View>
  );
}

export function TimeStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.timeStepper}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <StepperButton label={`Move ${label.toLowerCase()} 30 minutes earlier`} text="−" onPress={() => onChange(Math.max(0, value - 30))} />
        <Text style={styles.timeValue}>{minuteLabel(value)}</Text>
        <StepperButton label={`Move ${label.toLowerCase()} 30 minutes later`} text="+" onPress={() => onChange(Math.min(1440, value + 30))} />
      </View>
    </View>
  );
}

export function StepperButton({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}><Text style={styles.stepperText}>{text}</Text></Pressable>;
}

export function updateAvailabilityMinute(
  value: AdminSettingsState,
  onChange: (settings: AdminSettingsState) => void,
  index: number,
  key: 'startMin' | 'endMin',
  minute: number,
) {
  const availability = value.availability.map((day, dayIndex) => dayIndex === index ? { ...day, [key]: minute } : day);
  onChange({ ...value, availability });
}

export function minuteLabel(total: number): string {
  const normalized = Math.max(0, Math.min(total, 1439));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}
