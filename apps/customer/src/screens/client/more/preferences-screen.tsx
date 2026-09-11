import { useState, type ComponentProps } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Button, SectionTitle } from '@/components/ui';
import { STRENGTH_OPTIONS, strengthLabel } from '@/features/setup/setup';
import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { requestKey, type GuestPreferences } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { useInformationStyles } from './information-page';

export function Preferences({ onBack }: { onBack: () => void }) {
  const styles = useInformationStyles();
  const { portal, isDemo, refresh } = useAuth();
  const demo = useDemo();
  const initial: GuestPreferences = portal.preferences
    ?? { completed: false, notes: '', strength: 'medium', updatedAt: null };
  const [preferences, setPreferences] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function persist() {
    setSaving(true);
    try {
      const next = { ...preferences, completed: true, updatedAt: new Date().toISOString() };
      if (isDemo) {
        demo.updatePreferences(next);
      } else {
        const idempotencyKey = requestKey('preferences');
        // Only the fields the server accepts. The previous shape posted the
        // local-only `completed` and `updatedAt` too and was rejected 400 every
        // time; a Pick<> does not prevent that, because it is erased at runtime
        // and TypeScript skips excess-property checks on a variable.
        await mobileApi.updatePreferences({ notes: next.notes, strength: next.strength }, idempotencyKey);
        await refresh();
      }
      setPreferences(next);
      Alert.alert('Saved', 'The team can see your saved preferences.');
    } catch (error) {
      Alert.alert('Not saved', error instanceof Error ? error.message : 'Try again later.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsingScreen title="My usual" eyebrow="Saved for next time" onBack={onBack} keyboardShouldPersistTaps="handled">
      <Field
        label="What should the bar know?"
        value={preferences.notes}
        multiline
        onChangeText={(notes) => setPreferences({ ...preferences, notes })}
      />
      <SectionTitle>Coffee strength</SectionTitle>
      <View style={styles.options}>{STRENGTH_OPTIONS.map((strength) => (
        <Button
          key={strength}
          label={strengthLabel(strength)}
          variant={preferences.strength === strength ? 'primary' : 'secondary'}
          style={styles.option}
          onPress={() => setPreferences({ ...preferences, strength })}
        />
      ))}</View>
      <Button label="Save" loading={saving} disabled={saving} onPress={() => void persist()} />
    </CollapsingScreen>
  );
}
export function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  const styles = useInformationStyles();
  const tokens = useBrandTokens();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={`${label} input`} {...props} placeholderTextColor={tokens.textMuted} style={[styles.input, props.multiline && styles.multiline]} />
    </View>
  );
}
