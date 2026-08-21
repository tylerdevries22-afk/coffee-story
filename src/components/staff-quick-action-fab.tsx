import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeOptionPicker } from '@/components/native-option-picker';
import { SheetModal } from '@/components/sheet-modal';
import { Body, Button } from '@/components/ui';
import {
  buildAdminQuickActionSubmission,
  EMPTY_ADMIN_QUICK_ACTION_DRAFT,
  type AdminQuickActionDraft,
  type AdminQuickActionHandlers,
  type AdminQuickActionKey,
  type AdminQuickActionSubmission,
} from '@/features/admin/admin-quick-actions';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { colors, fonts, radius, scrim, shadow, spacing } from '@/theme/tokens';
import type { StaffClient } from '@/types/domain';
import { AppIcon, type AppIconName } from '@/components/icon';
import { choiceState } from '@/lib/a11y-state';
import { localIsoDate, localIsoTime, replaceLocalDateTime, upcomingDates } from '@/features/dates';

type SymbolName = AppIconName;
type ServiceChoice = { slug: string; name: string };

const ACTIONS: readonly {
  key: AdminQuickActionKey;
  label: string;
  symbol: SymbolName;
}[] = [
  { key: 'book', label: 'Book Appointment', symbol: 'calendar' },
  { key: 'quick-book', label: 'Quick Book', symbol: 'bolt' },
  { key: 'block-time', label: 'Block Time', symbol: 'clock' },
  { key: 'soap', label: 'Add SOAP Note', symbol: 'doc.text' },
] as const;

export function StaffQuickActionFab({
  clients,
  services,
  handlers,
  isDemo,
  open,
  onOpenChange,
  onQuickBook,
  bottomOffset,
}: {
  clients: readonly StaffClient[];
  services: readonly ServiceChoice[];
  handlers: AdminQuickActionHandlers;
  isDemo: boolean;
  /** Controlled by the nav bar's centred plus; the button lives there now. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quick Book opens checkout rather than a booking flow. */
  onQuickBook: () => void;
  /**
   * Clearance above the bottom edge, in points.
   *
   * Web's floating pill (`bottom-nav.tsx`) sits outside the safe area, so the
   * default here clears both it and the home indicator -- unchanged from
   * when this FAB was the pill's only caller. The native `+` tab
   * (`app/staff/quick-actions.tsx`) instead sits on a screen nested inside
   * `TabScreenSafeArea`, where `useSafeAreaInsets().bottom` already includes
   * the real `UITabBar`'s height (see that component), so it passes its own,
   * much smaller value rather than stacking this default on top of it.
   */
  bottomOffset?: number;
}) {
  const insets = useSafeAreaInsets();
  const fabBottom = bottomOffset ?? Math.max(insets.bottom, 10) + 100;
  const reducedMotion = useReducedMotion();
  const [animation] = useState(() => new Animated.Value(0));
  const [activeAction, setActiveAction] = useState<AdminQuickActionKey | null>(null);
  const pendingAction = useRef<AdminQuickActionKey | null>(null);
  // Only ever written from the close animation's completion callback, so the
  // effect below never sets state synchronously.
  const [settledClosed, setSettledClosed] = useState(!open);
  const menuVisible = open || !settledClosed;

  useEffect(() => {
    void Haptics.impactAsync(open ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    const timing = Animated.timing(animation, {
      toValue: open ? 1 : 0,
      duration: reducedMotion ? 0 : open ? 220 : 160,
      useNativeDriver: true,
    });
    timing.start(({ finished }) => {
      if (!finished) return;
      setSettledClosed(!open);
      if (!open && pendingAction.current) {
        const nextAction = pendingAction.current;
        pendingAction.current = null;
        setActiveAction(nextAction);
      }
    });
    return () => timing.stop();
  }, [animation, open, reducedMotion]);

  function setMenu(next: boolean) {
    onOpenChange(next);
  }

  function chooseAction(action: AdminQuickActionKey) {
    setMenu(false);
    void Haptics.selectionAsync();
    if (action === 'quick-book') {
      onQuickBook();
      return;
    }
    // Mount the sheet only after the speed dial has fully settled closed.
    // Native selectors inside the new sheet must not receive the same tap
    // through the transition (the Block Time row overlaps the Ends date control).
    pendingAction.current = action;
    setTimeout(() => {
      if (pendingAction.current !== action) return;
      pendingAction.current = null;
      setActiveAction(action);
    }, reducedMotion ? 0 : 220);
  }

  return (
    <>
      {menuVisible ? (
        // Keep the visual scrim non-interactive. The dismiss target sits below
        // the speed dial so a row press reaches chooseAction instead of
        // closing the menu through the full-screen backdrop.
        <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close quick actions"
          onPress={() => setMenu(false)}
          style={[StyleSheet.absoluteFill, styles.dismissLayer]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { opacity: animation.interpolate({ inputRange: [0, 1], outputRange: [0, scrim.opacity] }) }]}
        />
        </>
      ) : null}
      <View pointerEvents="box-none" style={[styles.fabLayer, { bottom: fabBottom }]}>
        {menuVisible ? (
          <Animated.View
            accessibilityRole="menu"
            style={[
              styles.speedDial,
              {
                opacity: animation,
                transform: [{ translateY: animation.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
              },
            ]}
          >
            {ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                testID={`staff-quick-action-${action.key}`}
                accessibilityRole="menuitem"
                accessibilityLabel={action.label}
                onPress={() => chooseAction(action.key)}
                style={({ pressed }) => [styles.speedItem, pressed && styles.pressed]}
              >
                <Text style={styles.speedLabel}>{action.label}</Text>
                <View style={styles.speedIcon}><AppIcon name={action.symbol} size={20} tintColor={colors.white} /></View>
              </Pressable>
            ))}
          </Animated.View>
        ) : null}
      </View>
      <QuickActionSheet
        action={activeAction}
        clients={clients}
        services={services}
        handlers={handlers}
        isDemo={isDemo}
        onClose={() => setActiveAction(null)}
      />
    </>
  );
}

function QuickActionSheet({
  action,
  clients,
  services,
  handlers,
  isDemo,
  onClose,
}: {
  action: AdminQuickActionKey | null;
  clients: readonly StaffClient[];
  services: readonly ServiceChoice[];
  handlers: AdminQuickActionHandlers;
  isDemo: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => initialDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function close() {
    setDraft(initialDraft());
    setError(null);
    setSuccess(null);
    onClose();
  }

  async function submit() {
    if (!action) return;
    const result = buildAdminQuickActionSubmission(action, draft);
    if (!result.ok) {
      setError(result.error);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await runHandler(result.value, handlers);
      setSuccess(isDemo ? 'Saved in the current demo workspace.' : successMessage(result.value.kind));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The action could not be completed.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetModal
      visible={Boolean(action)}
      onRequestClose={close}
      dismissLabel="Close quick action"
      keyboardAvoiding
      sheetStyle={styles.sheet}
    >
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <View style={styles.sheetCopy}>
          <Text style={styles.sheetEyebrow}>Quick action</Text>
          <Text style={styles.sheetTitle}>{actionTitle(action)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
          <AppIcon name="xmark" size={18} tintColor={colors.ink900} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
        {success ? (
          <View style={styles.successState}>
            <View style={styles.successMark}><AppIcon name="checkmark" size={24} tintColor={colors.white} /></View>
            <Text style={styles.successTitle}>Complete</Text>
            <Body muted>{success}</Body>
            <Button label="Done" onPress={close} />
          </View>
        ) : (
          <>
            {action === 'book' || action === 'quick-book' ? (
              <BookingFields action={action} draft={draft} clients={clients} services={services} onChange={setDraft} />
            ) : null}
            {action === 'block-time' ? <BlockTimeFields draft={draft} onChange={setDraft} /> : null}
            {action === 'soap' ? <SoapFields draft={draft} clients={clients} services={services} onChange={setDraft} /> : null}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Button testID="quick-action-submit" label={submitLabel(action)} loading={saving} disabled={saving} onPress={() => void submit()} />
            <Button label="Cancel" variant="secondary" disabled={saving} onPress={close} />
          </>
        )}
      </ScrollView>
    </SheetModal>
  );
}

function BookingFields({
  action,
  draft,
  clients,
  services,
  onChange,
}: {
  action: 'book' | 'quick-book';
  draft: AdminQuickActionDraft;
  clients: readonly StaffClient[];
  services: readonly ServiceChoice[];
  onChange: (draft: AdminQuickActionDraft) => void;
}) {
  return (
    <>
      <ChoiceField
        label="Client"
        choices={clients.map((client) => ({ id: client.id, label: client.fullName }))}
        selected={draft.customerId}
        onSelect={(customerId, clientName) => onChange({ ...draft, customerId, clientName })}
      />
      <ChoiceField
        label="Service"
        choices={services.map((service) => ({ id: service.slug, label: service.name }))}
        selected={draft.serviceSlug}
        onSelect={(serviceSlug, serviceName) => onChange({ ...draft, serviceSlug, serviceName })}
      />
      <NativeDateTimeFields label="Appointment" value={draft.startsAt} onChange={(startsAt) => onChange({ ...draft, startsAt })} />
      {action === 'book' ? <Field label="Visit notes" value={draft.notes} onChangeText={(notes) => onChange({ ...draft, notes })} multiline /> : null}
    </>
  );
}

function BlockTimeFields({ draft, onChange }: DraftFieldsProps) {
  return (
    <>
      <NativeDateTimeFields label="Starts" value={draft.startsAt} onChange={(startsAt) => onChange({ ...draft, startsAt })} />
      <NativeDateTimeFields label="Ends" value={draft.endsAt} onChange={(endsAt) => onChange({ ...draft, endsAt })} />
      <Field label="Reason" value={draft.reason} onChangeText={(reason) => onChange({ ...draft, reason })} placeholder="Lunch, studio reset, personal time…" />
    </>
  );
}

function SoapFields({
  draft,
  clients,
  services,
  onChange,
}: DraftFieldsProps & {
  clients: readonly StaffClient[];
  services: readonly ServiceChoice[];
}) {
  return (
    <>
      <ChoiceField
        label="Client"
        choices={clients.map((client) => ({ id: client.id, label: client.fullName }))}
        selected={draft.customerId}
        onSelect={(customerId, clientName) => onChange({ ...draft, customerId, clientName })}
      />
      <ChoiceField
        label="Service"
        choices={services.map((service) => ({ id: service.slug, label: service.name }))}
        selected={draft.serviceSlug}
        onSelect={(serviceSlug, serviceName) => onChange({ ...draft, serviceSlug, serviceName })}
      />
      <NativeOptionPicker
        label="Treatment date"
        value={draft.treatmentDate}
        options={upcomingDates(new Date(), 30)}
        onChange={(treatmentDate) => onChange({ ...draft, treatmentDate })}
      />
      <Field label="Subjective" value={draft.subjective} onChangeText={(subjective) => onChange({ ...draft, subjective })} multiline />
      <Field label="Objective" value={draft.objective} onChangeText={(objective) => onChange({ ...draft, objective })} multiline />
      <Field label="Assessment" value={draft.assessment} onChangeText={(assessment) => onChange({ ...draft, assessment })} multiline />
      <Field label="Plan" value={draft.plan} onChangeText={(plan) => onChange({ ...draft, plan })} multiline />
    </>
  );
}

type DraftFieldsProps = {
  draft: AdminQuickActionDraft;
  onChange: (draft: AdminQuickActionDraft) => void;
};

function NativeDateTimeFields({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const parsed = new Date(value);
  const fallback = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const dateOptions = upcomingDates(new Date(), 30);
  const currentDate = localIsoDate(fallback);
  const currentTime = localIsoTime(fallback);
  if (!dateOptions.some((option) => option.value === currentDate)) {
    dateOptions.unshift({ value: currentDate, label: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(fallback) });
  }

  return (
    <>
      <NativeOptionPicker
        label={`${label} date`}
        value={currentDate}
        options={dateOptions}
        onChange={(nextDate) => onChange(replaceLocalDateTime(value, nextDate, currentTime))}
      />
      <NativeOptionPicker
        label={`${label} time`}
        value={currentTime}
        options={timeOptions()}
        onChange={(nextTime) => onChange(replaceLocalDateTime(value, currentDate, nextTime))}
      />
    </>
  );
}

function timeOptions() {
  return Array.from({ length: 25 }, (_, index) => {
    const minutes = 8 * 60 + index * 30;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const sample = new Date(2026, 0, 1, hour, minute);
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { value, label: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(sample) };
  });
}

function ChoiceField({
  label,
  choices,
  selected,
  onSelect,
}: {
  label: string;
  choices: readonly { id: string; label: string }[];
  selected: string;
  onSelect: (id: string, label: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {choices.map((choice) => (
          <Pressable
            key={choice.id}
            accessibilityRole="radio"
            {...choiceState(selected === choice.id)}
            onPress={() => onSelect(choice.id, choice.label)}
            style={({ pressed }) => [styles.choice, selected === choice.id && styles.choiceActive, pressed && styles.pressed]}
          >
            <Text style={[styles.choiceText, selected === choice.id && styles.choiceTextActive]}>{choice.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  placeholder,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colors.ink400}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

async function runHandler(
  submission: AdminQuickActionSubmission,
  handlers: AdminQuickActionHandlers,
): Promise<void> {
  if (submission.kind === 'book') {
    if (!handlers.book) throw new Error('This booking workflow is not connected.');
    return handlers.book(submission);
  }
  if (submission.kind === 'quick-book') {
    if (!handlers['quick-book']) throw new Error('Quick Book is not connected.');
    return handlers['quick-book'](submission);
  }
  if (submission.kind === 'block-time') {
    if (!handlers['block-time']) throw new Error('Schedule blocking is not connected.');
    return handlers['block-time'](submission);
  }
  if (!handlers.soap) throw new Error('SOAP notes are not connected.');
  return handlers.soap(submission);
}

function initialDraft(): AdminQuickActionDraft {
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 1);
  startsAt.setHours(10, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return {
    ...EMPTY_ADMIN_QUICK_ACTION_DRAFT,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    treatmentDate: localIsoDate(startsAt),
  };
}

function actionTitle(action: AdminQuickActionKey | null): string {
  return ACTIONS.find((item) => item.key === action)?.label ?? 'Quick action';
}

function submitLabel(action: AdminQuickActionKey | null): string {
  if (action === 'block-time') return 'Block schedule';
  if (action === 'soap') return 'Save SOAP note';
  return 'Create appointment';
}

function successMessage(action: AdminQuickActionKey): string {
  if (action === 'block-time') return 'The availability block is live.';
  if (action === 'soap') return 'The SOAP note is saved to the client record.';
  return 'The appointment is confirmed on the schedule.';
}

const styles = StyleSheet.create({
  // Opacity is animated, so the colour here is solid and the scrim token
  // supplies the target strength.
  backdrop: { position: 'absolute', inset: 0, backgroundColor: scrim.color },
  dismissLayer: { zIndex: 20 },
  fabLayer: { position: 'absolute', right: spacing.md, zIndex: 30, alignItems: 'flex-end', gap: spacing.sm },
  speedDial: { alignItems: 'flex-end', gap: spacing.sm },
  speedItem: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  speedLabel: { overflow: 'hidden', color: colors.ink900, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.sansBold, fontSize: 13, ...shadow.card },
  speedIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand700, ...shadow.card },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand700, borderWidth: 1, borderColor: colors.brand300, ...shadow.card },
  sheet: { maxHeight: '88%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.surface, paddingTop: spacing.sm },
  sheetHandle: { width: 44, height: 5, borderRadius: radius.pill, backgroundColor: colors.ink200, alignSelf: 'center' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheetCopy: { flex: 1 },
  sheetEyebrow: { color: colors.brand600, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  sheetTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 28, lineHeight: 34, marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand50 },
  sheetContent: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand200, backgroundColor: colors.white, paddingHorizontal: spacing.md },
  choiceActive: { borderColor: colors.brand700, backgroundColor: colors.brand700 },
  choiceText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  choiceTextActive: { color: colors.white, fontFamily: fonts.sansBold },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink300, paddingHorizontal: spacing.md, backgroundColor: colors.white, color: colors.ink900, fontFamily: fonts.sans, fontSize: 16 },
  multiline: { minHeight: 92, paddingTop: spacing.md, textAlignVertical: 'top' },
  error: { color: colors.danger, fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 19 },
  successState: { gap: spacing.md, paddingVertical: spacing.xl },
  successMark: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  successTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 30 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
