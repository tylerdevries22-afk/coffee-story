import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { SheetModal } from '@/components/sheet-modal';
import { Button } from '@/components/ui';
import {
  CLIENT_GOAL_OPTIONS,
  DAY_OPTIONS,
  PREFERRED_TIME_OPTIONS,
  PRESSURE_OPTIONS,
  strengthLabel,
  SETUP_STEP_COUNT,
  STAFF_SPECIALTY_OPTIONS,
  portalSetup,
  setupSummary,
  toggleListItem,
  type AnyRoleSetup,
} from '@/features/setup/setup';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { AppRole, PortalSetupState } from '@/types/domain';
import { choiceState, toggleState } from '@/lib/a11y-state';

/**
 * The native setup flow — the same contract as the web portal's SetupPromptGate:
 * stable role selection may queue a delayed prompt; a persona that has not
 * finished setup gets the full wizard (resuming at its saved step), a persona
 * that has gets a light review card. Progress persists on the demo bundle.
 */

const ROLE_COPY: Record<AppRole, { title: string; subtitle: string; done: string }> = {
  client: {
    title: 'Set up your portal',
    subtitle: 'A minute now personalizes every visit',
    done: 'Your preferences now shape every order.',
  },
  staff: {
    title: 'Staff setup',
    subtitle: 'Your specialties and availability',
    done: 'Your schedule and services are ready for bookings.',
  },
  admin: {
    title: 'Studio setup',
    subtitle: 'Get Coffee Story ready for clients',
    done: 'The studio checklist now tracks these answers.',
  },
};

export function SetupFlowHost() {
  const { setupPromptRole, dismissSetupPrompt } = useAppState();
  const { isDemo } = useAuth();
  const { portal, updateSetup } = useDemo();
  // Each queued prompt decides its presentation exactly once — completed
  // persona → review card, anything else → wizard at the saved step — and the
  // decision is frozen so mid-wizard saves can't flip it. Derived during
  // render (the sanctioned adjust-state-from-props pattern) rather than in an
  // effect, which the React Compiler lint rejects.
  const [decision, setDecision] = useState<{ role: AppRole; view: 'review' | 'wizard' } | null>(null);
  if (setupPromptRole && isDemo && decision?.role !== setupPromptRole) {
    setDecision({
      role: setupPromptRole,
      view: portalSetup(portal)[setupPromptRole].status === 'completed' ? 'review' : 'wizard',
    });
  } else if (!setupPromptRole && decision) {
    setDecision(null);
  }

  if (!isDemo || !setupPromptRole || !decision) return null;

  if (decision.view === 'review') {
    return (
      <ReviewCard
        role={decision.role}
        setup={portalSetup(portal)}
        onReview={() => setDecision({ role: decision.role, view: 'wizard' })}
        onClose={dismissSetupPrompt}
      />
    );
  }

  return (
    <SetupWizardSheet
      role={decision.role}
      setup={portalSetup(portal)}
      onSave={updateSetup}
      onClose={dismissSetupPrompt}
    />
  );
}

function ReviewCard({
  role,
  setup,
  onReview,
  onClose,
}: {
  role: AppRole;
  setup: PortalSetupState;
  onReview: () => void;
  onClose: () => void;
}) {
  return (
    <SheetModal visible onRequestClose={onClose} dismissLabel="Dismiss" sheetStyle={styles.sheet}>
      <View style={styles.grabber} />
      <Text style={styles.title}>You&apos;re set up as {role}</Text>
      <Text style={styles.subtitle}>Everything from your last setup is saved</Text>
      <View style={styles.summary}>
        {setupSummary(role, setup).map((row) => (
          <View key={row.label} style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{row.label}</Text>
            <Text style={styles.summaryValue}>{row.value}</Text>
          </View>
        ))}
      </View>
      <Button label="Review my setup" onPress={onReview} />
      <Button label="Not now" variant="secondary" onPress={onClose} />
    </SheetModal>
  );
}

function SetupWizardSheet({
  role,
  setup,
  onSave,
  onClose,
}: {
  role: AppRole;
  setup: PortalSetupState;
  onSave: (role: AppRole, setup: AnyRoleSetup) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AnyRoleSetup>(() => setup[role]);
  const [step, setStep] = useState(() => (setup[role].status === 'in_progress' ? setup[role].step : 0));
  const [done, setDone] = useState(false);
  const copy = ROLE_COPY[role];
  const isLast = step === SETUP_STEP_COUNT - 1;

  const persist = (nextStep: number) => {
    onSave(role, { ...draft, status: 'in_progress', step: nextStep } as AnyRoleSetup);
  };

  const goForward = () => {
    if (!isLast) {
      const next = step + 1;
      setStep(next);
      persist(next);
      return;
    }
    onSave(role, { ...draft, status: 'completed', step } as AnyRoleSetup);
    setDone(true);
  };

  const closeKeepingProgress = () => {
    if (!done) persist(step);
    onClose();
  };

  return (
    <SheetModal
      visible
      onRequestClose={closeKeepingProgress}
      dismissLabel="Dismiss"
      keyboardAvoiding
      sheetStyle={[styles.sheet, styles.wizardSheet]}
    >
      <View style={styles.grabber} />
      {done ? (
        <View style={styles.doneBlock}>
          <View style={styles.doneBadge}>
            <Text style={styles.doneBadgeMark}>✓</Text>
          </View>
          <Text style={styles.title}>You&apos;re all set</Text>
          <Text style={styles.subtitle}>{copy.done}</Text>
          <Button label={role === 'client' ? 'Explore your portal' : 'Open the workspace'} onPress={onClose} />
        </View>
      ) : (
        <>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
          <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${SETUP_STEP_COUNT}`}>
            {Array.from({ length: SETUP_STEP_COUNT }, (_, index) => (
              <View key={index} style={[styles.dot, index <= step && styles.dotActive]} />
            ))}
          </View>
          <ScrollView style={styles.stepScroll} contentContainerStyle={styles.stepContent}>
            <StepBody role={role} step={step} draft={draft} onChange={setDraft} />
          </ScrollView>
          <View style={styles.footer}>
            {step > 0 ? (
              <Button label="Back" variant="secondary" style={styles.footerButton} onPress={() => setStep(step - 1)} />
            ) : (
              <View style={styles.footerButton} />
            )}
            <Button
              testID={isLast ? 'setup-finish' : 'setup-continue'}
              label={isLast ? 'Finish setup' : 'Continue'}
              style={styles.footerButton}
              onPress={goForward}
            />
          </View>
        </>
      )}
    </SheetModal>
  );
}

function StepBody({
  role,
  step,
  draft,
  onChange,
}: {
  role: AppRole;
  step: number;
  draft: AnyRoleSetup;
  onChange: (next: AnyRoleSetup) => void;
}) {
  if (role === 'client') {
    const answers = (draft as Extract<AnyRoleSetup, { answers: { goals: string[] } }>).answers;
    const set = (patch: Partial<typeof answers>) => onChange({ ...draft, answers: { ...answers, ...patch } } as AnyRoleSetup);
    if (step === 0) {
      return (
        <ChipGroup
          legend="What brings you in?"
          hint="Pick anything that applies — it shapes what we suggest."
          options={CLIENT_GOAL_OPTIONS}
          selected={answers.goals}
          onToggle={(goal) => set({ goals: toggleListItem(answers.goals, goal) })}
        />
      );
    }
    if (step === 1) {
      return (
        <View style={styles.stepGap}>
          <ChipGroup
            legend="Coffee strength"
            options={PRESSURE_OPTIONS}
            selected={[answers.pressure]}
            onToggle={(pressure) => set({ pressure: pressure as typeof answers.pressure })}
            formatLabel={strengthLabel}
            single
          />
          <ChipGroup
            legend="Best times to swing by"
            options={PREFERRED_TIME_OPTIONS}
            selected={answers.preferredTimes}
            onToggle={(time) => set({ preferredTimes: toggleListItem(answers.preferredTimes, time) })}
          />
        </View>
      );
    }
    return (
      <SummaryBlock
        rows={[
          { label: 'Goals', value: answers.goals.length ? answers.goals.join(', ') : '—' },
          { label: 'Strength', value: strengthLabel(answers.pressure) },
          { label: 'Best times', value: answers.preferredTimes.length ? answers.preferredTimes.join(', ') : 'Flexible' },
        ]}
      />
    );
  }

  if (role === 'staff') {
    const answers = (draft as Extract<AnyRoleSetup, { answers: { specialties: string[] } }>).answers;
    const set = (patch: Partial<typeof answers>) => onChange({ ...draft, answers: { ...answers, ...patch } } as AnyRoleSetup);
    if (step === 0) {
      return (
        <ChipGroup
          legend="Your specialties"
          hint="Shown on your profile and used to match bookings."
          options={STAFF_SPECIALTY_OPTIONS}
          selected={answers.specialties}
          onToggle={(item) => set({ specialties: toggleListItem(answers.specialties, item) })}
        />
      );
    }
    if (step === 1) {
      return (
        <ChipGroup
          legend="Days you work"
          hint="Online booking only offers times on these days."
          options={DAY_OPTIONS}
          selected={answers.workingDays}
          onToggle={(day) => set({ workingDays: toggleListItem(answers.workingDays, day) })}
        />
      );
    }
    return (
      <SummaryBlock
        rows={[
          { label: 'Specialties', value: answers.specialties.length ? answers.specialties.join(', ') : '—' },
          { label: 'Days available', value: answers.workingDays.length ? `${answers.workingDays.length} of 7` : '—' },
        ]}
      />
    );
  }

  const answers = (draft as Extract<AnyRoleSetup, { answers: { businessName: string } }>).answers;
  const set = (patch: Partial<typeof answers>) => onChange({ ...draft, answers: { ...answers, ...patch } } as AnyRoleSetup);
  if (step === 0) {
    return (
      <View style={styles.stepGap}>
        <View>
          <Text style={styles.legend}>Business name</Text>
          <TextInput
            value={answers.businessName}
            onChangeText={(businessName) => set({ businessName })}
            style={styles.input}
            placeholder="Studio name"
            placeholderTextColor={colors.ink400}
          />
        </View>
        <ToggleLine
          label="Accept online booking"
          hint="Clients can self-book from the app and website"
          value={answers.onlineBooking}
          onChange={(onlineBooking) => set({ onlineBooking })}
        />
      </View>
    );
  }
  if (step === 1) {
    return (
      <ChipGroup
        legend="Days the studio is open"
        options={DAY_OPTIONS}
        selected={answers.openDays}
        onToggle={(day) => set({ openDays: toggleListItem(answers.openDays, day) })}
      />
    );
  }
  return (
    <View style={styles.stepGap}>
      <ToggleLine
        label="My service menu looks right"
        value={answers.servicesConfirmed}
        onChange={(servicesConfirmed) => set({ servicesConfirmed })}
      />
      <ToggleLine
        label="My team is up to date"
        value={answers.teamConfirmed}
        onChange={(teamConfirmed) => set({ teamConfirmed })}
      />
      <SummaryBlock
        rows={[
          { label: 'Studio', value: answers.businessName || '—' },
          { label: 'Open days', value: answers.openDays.length ? `${answers.openDays.length} of 7` : '—' },
          { label: 'Online booking', value: answers.onlineBooking ? 'On' : 'Off' },
        ]}
      />
    </View>
  );
}

function ChipGroup({
  legend,
  hint,
  options,
  selected,
  onToggle,
  single = false,
  formatLabel,
}: {
  legend: string;
  hint?: string;
  options: readonly string[];
  selected: readonly string[];
  onToggle: (option: string) => void;
  single?: boolean;
  /** Wire values stay stable; what a person reads can differ. */
  formatLabel?: (option: string) => string;
}) {
  return (
    <View accessibilityRole={single ? 'radiogroup' : undefined} accessibilityLabel={legend}>
      <Text style={styles.legend}>{legend}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <Pressable
              key={option}
              accessibilityRole={single ? 'radio' : 'button'}
              // Multi-select chips are buttons, where the on/off cue has to be
              // `aria-pressed`; only the single-select group is a real radio.
              {...(single ? choiceState(on) : toggleState(on))}
              onPress={() => onToggle(option)}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{formatLabel ? formatLabel(option) : option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ToggleLine({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.toggleLine}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.brand600, false: colors.ink200 }}
        thumbColor={colors.white}
      />
    </View>
  );
}

function SummaryBlock({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <View style={styles.summary}>
      {rows.map((row) => (
        <View key={row.label} style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{row.label}</Text>
          <Text style={styles.summaryValue} numberOfLines={2}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
  },
  wizardSheet: {
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.brand100,
  },
  title: {
    color: colors.ink900,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 31,
  },
  subtitle: {
    color: colors.ink500,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 19,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.ink200,
  },
  dotActive: {
    backgroundColor: colors.brand600,
  },
  stepScroll: {
    flexGrow: 0,
  },
  stepContent: {
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  stepGap: {
    gap: spacing.md,
  },
  legend: {
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 14,
  },
  hint: {
    marginTop: 2,
    color: colors.ink500,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
  },
  chipWrap: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand200,
    backgroundColor: colors.white,
  },
  chipOn: {
    borderColor: colors.brand600,
    backgroundColor: colors.brand600,
  },
  chipLabel: {
    color: colors.ink700,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    textTransform: 'capitalize',
  },
  chipLabelOn: {
    color: colors.white,
  },
  input: {
    marginTop: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ink300,
    backgroundColor: colors.white,
    color: colors.ink900,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  toggleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warm,
  },
  toggleCopy: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 14,
  },
  summary: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warm,
  },
  summaryLabel: {
    color: colors.ink500,
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  summaryValue: {
    flex: 1,
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 13,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  doneBlock: {
    alignItems: 'stretch',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  doneBadge: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  doneBadgeMark: {
    color: colors.white,
    fontFamily: fonts.sansBold,
    fontSize: 22,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  footerButton: {
    flex: 1,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
});
