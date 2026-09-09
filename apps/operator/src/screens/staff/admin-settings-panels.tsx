import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Body, Card } from '@/components/ui';
import { ADMIN_SETTINGS_TABS, isAdminSettingWritableInLive, type AdminSettingsState, type AdminSettingsTab } from '@/features/admin/admin-settings';
import { useAuth } from '@/state/auth-context';
import { tabState, useTokens as useBrandTokens } from '@platform/ui';
import { createStyles } from './admin-settings-styles';
import { minuteLabel, NumberField, PanelHeading, TimeStepper, ToggleRow,
  updateAvailabilityMinute } from './admin-settings-fields';

type SettingsPanelProps = { value: AdminSettingsState; onChange: (settings: AdminSettingsState) => void; };

export function SettingsTabRail({
  value,
  onChange,
}: {
  value: AdminSettingsTab;
  onChange: (tab: AdminSettingsTab) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  // Forms decide what clients put their name to, so a team member never sees
  // the tab -- the panel behind it is gated on the same check.
  const { role } = useAuth();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabRailScroll}
      contentContainerStyle={styles.tabRail}
      accessibilityRole="tablist"
    >
      {ADMIN_SETTINGS_TABS.filter((tab) => tab !== 'Forms' || role === 'admin').map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            {...tabState(selected)}
            onPress={() => onChange(tab)}
            style={({ pressed }) => [styles.tab, selected && styles.tabActive, pressed && styles.pressed]}
          >
            <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function AvailabilityPanel({ value, onChange }: SettingsPanelProps) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.panel}>
      <PanelHeading title="Shop availability" detail="Thirty-minute adjustments keep each day predictable." />
      {value.availability.map((day, index) => (
        <View key={day.weekday} style={styles.dayRow}>
          <View style={styles.dayHeading}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{day.label}</Text>
              <Text style={styles.rowDetail}>{day.enabled ? `${minuteLabel(day.startMin)}–${minuteLabel(day.endMin)}` : 'Closed'}</Text>
            </View>
            <Switch
              accessibilityLabel={`${day.label} availability`}
              value={day.enabled}
              onValueChange={(enabled) => {
                const availability = value.availability.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item);
                onChange({ ...value, availability });
              }}
              trackColor={{ false: tokens.secondary, true: tokens.secondary }}
              thumbColor={tokens.surfaceElevated}
            />
          </View>
          {day.enabled ? (
            <View style={styles.timeGrid}>
              <TimeStepper
                label="Opens"
                value={day.startMin}
                onChange={(startMin) => updateAvailabilityMinute(value, onChange, index, 'startMin', startMin)}
              />
              <TimeStepper
                label="Closes"
                value={day.endMin}
                onChange={(endMin) => updateAvailabilityMinute(value, onChange, index, 'endMin', endMin)}
              />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function BookingRulesPanel({ value, onChange }: SettingsPanelProps) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.panel}>
      <PanelHeading title="Online booking rules" detail="Set expectations before a guest selects a time." />
      <ToggleRow label="Online booking" detail="Allow clients to reserve from the portal." value={value.onlineOrderingEnabled} onChange={(onlineOrderingEnabled) => onChange({ ...value, onlineOrderingEnabled })} />
      <ToggleRow label="Account required" detail="Require sign-in before checkout." value={value.requireAccountToBook} onChange={(requireAccountToBook) => onChange({ ...value, requireAccountToBook })} />
      <ToggleRow label="Waitlist" detail="Collect interest when a day is full." value={value.waitlistEnabled} onChange={(waitlistEnabled) => onChange({ ...value, waitlistEnabled })} />
      <NumberField label="Minimum lead time (minutes)" value={value.leadTimeMinutes} onChange={(leadTimeMinutes) => onChange({ ...value, leadTimeMinutes })} />
      <NumberField label="Cancellation window (hours)" value={value.cancellationHours} onChange={(cancellationHours) => onChange({ ...value, cancellationHours })} />
    </View>
  );
}

export function PaymentsPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.panel}>
      <PanelHeading title="Payments" detail="Apply consistent payment expectations across booking and checkout." />
      <ToggleRow label="Require prepayment" detail="Collect the configured service deposit at booking." value={value.requireDeposit} onChange={(requireDeposit) => onChange({ ...value, requireDeposit })} />
      <ToggleRow label="Prompt for gratuity" detail="Offer tip options at staff checkout." value={value.promptForTip} onChange={(promptForTip) => onChange({ ...value, promptForTip })} />
      <ToggleRow label="Store card on file" detail="Ask clients for permission to save a payment method." value={value.storeCardOnFile} onChange={(storeCardOnFile) => onChange({ ...value, storeCardOnFile })} />
      <Card style={styles.integrationCard}>
        <Text style={styles.rowTitle}>Stripe</Text>
        <Text style={styles.connected}>{isDemo ? 'Demo connection' : 'Checked at checkout'}</Text>
        <Body muted>{isDemo
          ? 'The preview simulates the secure native payment sheet without charging a card.'
          : 'This page saves payment preferences only. Live provider availability is verified when checkout starts.'}</Body>
      </Card>
    </View>
  );
}

export function MessagesPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.panel}>
      <PanelHeading title="Outgoing messages" detail="Choose the follow-ups guests receive automatically." />
      <ToggleRow label="Booking confirmations" detail="Send immediately after a reservation." value={value.confirmationsEnabled} disabled={!isDemo && !isAdminSettingWritableInLive('confirmationsEnabled')} onChange={(confirmationsEnabled) => onChange({ ...value, confirmationsEnabled })} />
      <ToggleRow label="Order reminders" detail="Send before a scheduled order." value={value.remindersEnabled} disabled={!isDemo && !isAdminSettingWritableInLive('remindersEnabled')} onChange={(remindersEnabled) => onChange({ ...value, remindersEnabled })} />
      <ToggleRow label="Review requests" detail="Invite feedback after completed care." value={value.reviewRequestEnabled} onChange={(reviewRequestEnabled) => onChange({ ...value, reviewRequestEnabled })} />
    </View>
  );
}
