import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { AppIcon } from '@/components/icon';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, Eyebrow } from '@/components/ui';
import {
  ADMIN_SETTINGS_TABS,
  isAdminSettingWritableInLive,
  isAdminSettingsTabWritableInLive,
  validateAdminSettings,
  type AdminSettingsState,
  type AdminSettingsTab,
} from '@/features/admin/admin-settings';
import { INTAKE_FORM_CATALOG, type IntakeFormCatalogEntry } from '@/features/admin/preferences-forms';
import { mobileApi } from '@/lib/mobile-api';
import { openWebPath } from '@/lib/web-navigation';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { tabState } from '@/lib/a11y-state';

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

function SettingsTabRail({
  value,
  onChange,
}: {
  value: AdminSettingsTab;
  onChange: (tab: AdminSettingsTab) => void;
}) {
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

function AvailabilityPanel({ value, onChange }: SettingsPanelProps) {
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
              trackColor={{ false: colors.ink200, true: colors.brand300 }}
              thumbColor={colors.white}
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

function BookingRulesPanel({ value, onChange }: SettingsPanelProps) {
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

function PaymentsPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
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

function MessagesPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
  return (
    <View style={styles.panel}>
      <PanelHeading title="Outgoing messages" detail="Choose the follow-ups guests receive automatically." />
      <ToggleRow label="Booking confirmations" detail="Send immediately after a reservation." value={value.confirmationsEnabled} disabled={!isDemo && !isAdminSettingWritableInLive('confirmationsEnabled')} onChange={(confirmationsEnabled) => onChange({ ...value, confirmationsEnabled })} />
      <ToggleRow label="Order reminders" detail="Send before a scheduled order." value={value.remindersEnabled} disabled={!isDemo && !isAdminSettingWritableInLive('remindersEnabled')} onChange={(remindersEnabled) => onChange({ ...value, remindersEnabled })} />
      <ToggleRow label="Review requests" detail="Invite feedback after completed care." value={value.reviewRequestEnabled} onChange={(reviewRequestEnabled) => onChange({ ...value, reviewRequestEnabled })} />
    </View>
  );
}

function FormsPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
  // Seeded from the bundled catalog so the list is right offline and in the
  // Expo Go demo, then replaced by whatever the site is actually publishing.
  const [drafts, setDrafts] = useState<IntakeFormCatalogEntry[]>(() => INTAKE_FORM_CATALOG.map((form) => ({ ...form })));
  const [saved, setSaved] = useState<IntakeFormCatalogEntry[]>(() => INTAKE_FORM_CATALOG.map((form) => ({ ...form })));
  // One open at a time: four expanded forms was an unreadable column.
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) return;
    let alive = true;
    mobileApi.intakeForms()
      .then((body) => {
        if (!alive || !body?.forms?.length) return;
        setDrafts(body.forms.map((form) => ({ ...form })));
        setSaved(body.forms.map((form) => ({ ...form })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isDemo]);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved);
  const update = (id: string, patch: Partial<IntakeFormCatalogEntry>) =>
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const body = await mobileApi.updateIntakeForms(drafts);
      const next = body?.forms?.length ? body.forms.map((form) => ({ ...form })) : drafts;
      setDrafts(next);
      setSaved(next);
      setNotice('Saved. The site and both portals now show this.');
    } catch {
      // The endpoint is owner-only, so this is the expected answer for a demo
      // session or a team member rather than a fault worth alarming about.
      setNotice('Sign in as the owner to change these. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      <PanelHeading title="Forms & documents" detail="Keep consent requirements visible before care begins." />
      <ToggleRow label="No usual saved" detail="Require a current preferences before the first session." value={value.intakeRequired} disabled={!isDemo} onChange={(intakeRequired) => onChange({ ...value, intakeRequired })} />
      <ToggleRow label="Care consent required" detail="Require an accepted consent record." value={value.consentRequired} disabled={!isDemo} onChange={(consentRequired) => onChange({ ...value, consentRequired })} />

      <Card style={styles.formSummary}>
        <Text style={styles.rowTitle}>
          {drafts.length} active document{drafts.length === 1 ? '' : 's'}
        </Text>
        <Body muted>These are the documents clients sign, and the same list the website publishes.</Body>
        {drafts.map((draft) => {
          const open = openId === draft.id;
          return (
            <View key={draft.id} style={styles.formRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={draft.title}
                accessibilityHint={open ? 'Collapses this form' : 'Opens this form for editing'}
                accessibilityState={{ expanded: open }}
                onPress={() => setOpenId(open ? null : draft.id)}
                style={({ pressed }) => [styles.formHeader, pressed && styles.formHeaderPressed]}
              >
                <View style={styles.formHeaderCopy}>
                  <Eyebrow>{draft.eyebrow}</Eyebrow>
                  <Text style={styles.rowTitle}>{draft.title}</Text>
                  {/* Collapsed, the summary is the one line that tells the two
                      consent documents apart; expanded, the fields say it. */}
                  {open ? null : <Body muted>{draft.summary}</Body>}
                </View>
                <AppIcon name={open ? 'chevron.down' : 'chevron.right'} size={15} tintColor={colors.brand700} />
              </Pressable>

              {open ? (
                <View style={styles.formFields}>
                  <Body muted>{draft.summary}</Body>
                  <Field label="Title" value={draft.title} editable onChangeText={(title) => update(draft.id, { title })} />
                  <Field label="Asked for at" value={draft.stage} editable onChangeText={(stage) => update(draft.id, { stage })} />
                  <Field label="Time to complete" value={draft.duration} editable onChangeText={(duration) => update(draft.id, { duration })} />
                  <Field label="Version" value={draft.version} editable onChangeText={(version) => update(draft.id, { version })} />
                  {/* The published document, opened where a client would read
                      it. The questions themselves live on the site, so this is
                      the only way to check what these fields are describing. */}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`View ${draft.title} on the website`}
                    onPress={() => void openWebPath(`/preferences-forms#${draft.id}`).catch(() => setNotice('That page could not be opened on this device.'))}
                    style={({ pressed }) => [styles.viewOnSite, pressed && styles.formHeaderPressed]}
                  >
                    <Text style={styles.viewOnSiteLabel}>View on the website</Text>
                    <AppIcon name="chevron.right" size={13} tintColor={colors.brand700} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      {notice ? <Body muted>{notice}</Body> : null}
      <Button label={busy ? 'Saving…' : 'Save forms'} onPress={() => void save()} disabled={!dirty || busy} />
      <Body muted>
        A new form needs its questions built in the app first, so this edits the four that exist rather than adding to them.
      </Body>
    </View>
  );
}

function BusinessInfoPanel({ value, onChange, isDemo }: SettingsPanelProps & { isDemo: boolean }) {
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

function PanelHeading({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.heading}><Text style={styles.panelTitle}>{title}</Text><Text style={styles.panelDetail}>{detail}</Text></View>;
}

function ToggleRow({ label, detail, value, disabled = false, onChange }: { label: string; detail: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={[styles.toggleRow, disabled && styles.controlDisabled]}>
      <View style={styles.flex}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
      <Switch accessibilityLabel={label} disabled={disabled} value={value} onValueChange={onChange} trackColor={{ false: colors.ink200, true: colors.brand300 }} thumbColor={colors.white} />
    </View>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <Field label={label} value={String(value)} keyboardType="number-pad" onChangeText={(next) => onChange(Number(next.replace(/\D/g, '')) || 0)} />;
}

function Field({
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

function TimeStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
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

function StepperButton({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}><Text style={styles.stepperText}>{text}</Text></Pressable>;
}

function updateAvailabilityMinute(
  value: AdminSettingsState,
  onChange: (settings: AdminSettingsState) => void,
  index: number,
  key: 'startMin' | 'endMin',
  minute: number,
) {
  const availability = value.availability.map((day, dayIndex) => dayIndex === index ? { ...day, [key]: minute } : day);
  onChange({ ...value, availability });
}

function minuteLabel(total: number): string {
  const normalized = Math.max(0, Math.min(total, 1439));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

const styles = StyleSheet.create({
  // The rail runs edge to edge: a negative margin cancels the Screen's own
  // horizontal padding, and the content pads itself back so the first and last
  // pill still line up with the copy above them. Without this the pills were
  // sheared off at the content inset rather than running off the screen.
  tabRailScroll: { marginHorizontal: -spacing.lg },
  tabRail: { gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.lg },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand100, backgroundColor: colors.white },
  tabActive: { backgroundColor: colors.brand700, borderColor: colors.brand700 },
  tabText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  tabTextActive: { color: colors.white, fontFamily: fonts.sansBold },
  panel: { gap: spacing.md },
  heading: { gap: spacing.xs, paddingTop: spacing.sm },
  panelTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 22 },
  panelDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  toggleRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(70,48,78,0.12)' },
  flex: { flex: 1 },
  rowTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  rowDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 3 },
  dayRow: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(70,48,78,0.12)' },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  timeGrid: { flexDirection: 'row', gap: spacing.sm },
  timeStepper: { flex: 1, gap: spacing.xs },
  stepperControls: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, backgroundColor: colors.white },
  stepperButton: { width: 44, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 22 },
  timeValue: { flex: 1, color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 12, textAlign: 'center' },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 12 },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink300, paddingHorizontal: spacing.md, color: colors.ink900, fontFamily: fonts.sans, fontSize: 16, backgroundColor: colors.white },
  multiline: { minHeight: 90, paddingTop: spacing.md, textAlignVertical: 'top' },
  integrationCard: { gap: spacing.sm, backgroundColor: colors.brand50 },
  connected: { alignSelf: 'flex-start', color: colors.success, fontFamily: fonts.sansBold, fontSize: 12, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.white },
  formSummary: { gap: spacing.xs },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 64, paddingVertical: spacing.sm },
  formHeaderPressed: { opacity: 0.72 },
  formHeaderCopy: { flex: 1, gap: 2 },
  formFields: { gap: spacing.sm, paddingBottom: spacing.sm },
  viewOnSite: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  viewOnSiteLabel: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 14 },
  formRow: { gap: 2, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: 'rgba(70,48,78,0.12)' },
  formTitle: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 15 },
  helper: { color: colors.warning, fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 18 },
  controlDisabled: { opacity: 0.55 },
  error: { color: colors.danger, fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 19 },
  notice: { color: colors.success, fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
