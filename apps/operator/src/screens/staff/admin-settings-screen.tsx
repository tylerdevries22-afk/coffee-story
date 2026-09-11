import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Text } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button } from '@/components/ui';
import {
  isAdminSettingsTabWritableInLive,
  validateAdminSettings,
  type AdminSettingsState,
  type AdminSettingsTab,
} from '@/features/admin/admin-settings';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { useTokens as useBrandTokens } from '@platform/ui';

import { BusinessInfoPanel } from './admin-settings-fields';
import { FormsPanel } from './admin-settings-forms';
import { AvailabilityPanel, BookingRulesPanel, MessagesPanel, PaymentsPanel, SettingsTabRail } from './admin-settings-panels';
import { createStyles } from './admin-settings-styles';

type AdminSettingsScreenProps = {
  settings: AdminSettingsState;
  isDemo: boolean;
  loading: boolean;
  onBack: () => void;
  onSave: (settings: AdminSettingsState) => Promise<void>;
};

export function AdminSettingsScreen({
  settings,
  isDemo,
  loading,
  onBack,
  onSave,
}: AdminSettingsScreenProps) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { role } = useAuth();
  const tone = workspaceTone(role);
  const [tab, setTab] = useState<AdminSettingsTab>('Availability');
  const [draft, setDraft] = useState(settings);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const liveSaveUnavailable = !isDemo && !isAdminSettingsTabWritableInLive(tab);

  async function save() {
    if (liveSaveUnavailable) {
      setError('This settings group is read-only until its live save contract is connected.');
      return;
    }
    const validationError = validateAdminSettings(draft, !isDemo);
    if (validationError) {
      setError(validationError);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError(null);
    try {
      await onSave(draft);
      setNotice(isDemo ? 'Preview settings saved for this demo session.' : 'Business settings saved securely.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  return (
    <CollapsingScreen title="Settings" eyebrow="Configuration" onBack={onBack} tone={tone} keyboardShouldPersistTaps="handled">
      <Body muted>Control the operational rules shared by web and native booking.</Body>
      <SettingsTabRail value={tab} onChange={(next) => {
        setTab(next);
        setNotice(null);
        void Haptics.selectionAsync();
      }} />
      {tab === 'Availability' ? <AvailabilityPanel value={draft} onChange={setDraft} /> : null}
      {tab === 'Booking Rules' ? <BookingRulesPanel value={draft} onChange={setDraft} /> : null}
      {tab === 'Payments' ? <PaymentsPanel value={draft} onChange={setDraft} isDemo={isDemo} /> : null}
      {tab === 'Messages' ? <MessagesPanel value={draft} onChange={setDraft} isDemo={isDemo} /> : null}
      {tab === 'Forms' && role === 'admin' ? <FormsPanel value={draft} onChange={setDraft} isDemo={isDemo} /> : null}
      {tab === 'Business Info' ? <BusinessInfoPanel value={draft} onChange={setDraft} isDemo={isDemo} /> : null}
      {!isDemo && tab === 'Messages' ? (
        <Text style={styles.helper}>
          Booking confirmations and order reminders are read-only here. Review-request changes are connected and can be saved.
        </Text>
      ) : null}
      {!isDemo && tab === 'Forms' ? (
        <Text style={styles.helper}>
          Live form requirements are read-only until the forms settings endpoint is connected. No changes on this tab will be saved.
        </Text>
      ) : null}
      {!isDemo && tab === 'Business Info' ? (
        <Text style={styles.helper}>
          Live business identity is read-only until its settings endpoint is connected. No changes on this tab will be saved.
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      <Button
        label={liveSaveUnavailable ? 'Live save unavailable' : 'Save changes'}
        loading={loading}
        disabled={loading || liveSaveUnavailable}
        onPress={() => void save()}
      />
    </CollapsingScreen>
  );
}
