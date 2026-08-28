import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { operationDisplayStatus, validateOperationResponses } from '@platform/domain';
import { useTokens, type BrandTokens } from '@platform/ui';

import { AppIcon } from '@/components/icon';
import { Body, Button, Card } from '@/components/ui';
import { taskEligibilityMessage, type OperatorChecklistStep,
  type OperatorTaskOccurrence } from '@/features/operations/model';
import type {
  OperationIntentIssue,
  OperationIntentResponse,
} from '@/features/operations/offline-intents';
import { useAuth } from '@/state/auth-context';
import { useOperations } from '@/state/operations-store';

type ResponseMap = Record<string, OperationIntentResponse>;
type IssueMap = Record<string, OperationIntentIssue>;

function withResponse(current: ResponseMap, key: string, value: OperationIntentResponse | undefined): ResponseMap {
  if (value !== undefined) return { ...current, [key]: value };
  const next = { ...current };
  delete next[key];
  return next;
}

export function OperationDetailScreen({ occurrenceId }: { occurrenceId: string }) {
  const tokens = useTokens();
  const styles = createStyles(tokens);
  const { brandUserId } = useAuth();
  const operations = useOperations();
  const task = operations.occurrences.find((item) => item.id === occurrenceId);
  if (!task) return <MissingOperation styles={styles} />;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <DetailHeader styles={styles} />
      <OperationForm actorId={brandUserId} styles={styles} task={task} />
    </SafeAreaView>
  );
}

function DetailHeader({ styles }: { styles: ReturnType<typeof createStyles> }) {
  const tokens = useTokens();
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Back to shift operations" accessibilityRole="button"
        hitSlop={8} onPress={() => router.back()} style={styles.headerButton}>
        <AppIcon name="chevron.left" size={22} tintColor={tokens.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle}>Shift operation</Text>
      <View style={styles.headerButton} />
    </View>
  );
}

function OperationForm({ actorId, styles, task }: {
  actorId: string | null;
  styles: ReturnType<typeof createStyles>;
  task: OperatorTaskOccurrence;
}) {
  const tokens = useTokens();
  const operations = useOperations();
  const [responses, setResponses] = useState<ResponseMap>({});
  const [issues, setIssues] = useState<IssueMap>({});
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const displayStatus = operationDisplayStatus(task, operations.now);
  const owned = task.claimedBy === actorId && ['claimed', 'overdue'].includes(displayStatus);
  const completionIssues = useMemo(() => Object.values(issues)
    .filter((issue) => issue.description.trim().length > 0
      && issue.stepKey !== null && responses[issue.stepKey] === false), [issues, responses]);

  const finish = async () => {
    const validation = validateOperationResponses(task.snapshot.steps, responses,
      new Set(completionIssues.map((issue) => issue.stepKey).filter((key): key is string => key !== null)));
    if (!validation.valid) {
      setFormError('Complete every required check and describe an issue for each failed check.');
      return;
    }
    setSubmitting(true);
    try {
      await operations.complete(task.id, { responses, note: note.trim(), issues: completionIssues });
      router.back();
    } catch {
      setFormError('This completion could not be saved. Review the checklist and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OperationHero styles={styles} task={task} />
        {formError ? <Text accessibilityRole="alert" style={styles.error}>{formError}</Text> : null}
        {!owned ? <ClaimCard styles={styles} task={task} /> : null}
        {owned ? task.snapshot.steps.map((step, index) => (
          <StepCard key={step.key} issue={issues[step.key]} number={index + 1}
            onIssue={(issue) => setIssues((current) => ({ ...current, [step.key]: issue }))}
            onResponse={(value) => setResponses((current) => withResponse(current, step.key, value))}
            response={responses[step.key]} step={step} styles={styles} task={task} />
        )) : null}
        {owned ? <TextInput accessibilityLabel="Completion note" maxLength={2_000} multiline
          onChangeText={setNote} placeholder="Optional handoff note" placeholderTextColor={tokens.textMuted}
          style={[styles.input, styles.note]} value={note} /> : null}
        {owned ? <View style={styles.actions}>
          <Button disabled={submitting} label="Complete operation" loading={submitting} onPress={() => void finish()} />
          <Button label="Release task" variant="secondary" onPress={() => void operations.release(task.id).then(() => router.back())} />
        </View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OperationHero({ styles, task }: {
  styles: ReturnType<typeof createStyles>; task: OperatorTaskOccurrence;
}) {
  return (
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>{task.status.toUpperCase()}</Text>
      <Text style={styles.title}>{task.snapshot.title}</Text>
      {task.snapshot.instructions ? <Body muted>{task.snapshot.instructions}</Body> : null}
      <Body muted>Due {new Date(task.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        {' · '}{task.snapshot.estimatedMinutes} min</Body>
    </View>
  );
}

function ClaimCard({ styles, task }: {
  styles: ReturnType<typeof createStyles>; task: OperatorTaskOccurrence;
}) {
  const operations = useOperations();
  const upcoming = Date.parse(task.scheduledFor) > operations.now.getTime();
  const eligibility = taskEligibilityMessage(task);
  const unavailable = task.claimedBy !== null || upcoming || eligibility !== null;
  const message = task.claimedBy !== null
    ? 'Another team member currently owns this checklist.'
    : upcoming ? 'This operation can be claimed when its scheduled window begins.'
      : eligibility ?? 'Claiming records ownership and keeps completion evidence attributable.';
  return (
    <Card style={styles.claimCard}>
      <Text style={styles.cardTitle}>{unavailable ? 'Not claimable yet' : 'Ready to begin?'}</Text>
      <Body muted>{message}</Body>
      {!unavailable ? <Button label="Claim operation" onPress={() => void operations.claim(task.id)} /> : null}
    </Card>
  );
}

function StepCard({ issue, number, onIssue, onResponse, response, step, styles, task }: {
  issue?: OperationIntentIssue; number: number; onIssue: (issue: OperationIntentIssue) => void;
  onResponse: (value: OperationIntentResponse | undefined) => void; response?: OperationIntentResponse;
  step: OperatorChecklistStep; styles: ReturnType<typeof createStyles>; task: OperatorTaskOccurrence;
}) {
  return (
    <Card style={styles.stepCard}>
      <Text style={styles.stepNumber}>STEP {number}</Text>
      <Text style={styles.cardTitle}>{step.title}</Text>
      {step.instructions ? <Body muted>{step.instructions}</Body> : null}
      <StepResponse onChange={onResponse} response={response} step={step} styles={styles} />
      {step.issueOnFailure && response === false ? (
        <IssueFields categories={task.snapshot.issueCategories} issue={issue} onChange={onIssue}
          stepKey={step.key} styles={styles} />
      ) : null}
    </Card>
  );
}

function StepResponse({ onChange, response, step, styles }: {
  onChange: (value: OperationIntentResponse | undefined) => void; response?: OperationIntentResponse;
  step: OperatorChecklistStep; styles: ReturnType<typeof createStyles>;
}) {
  const tokens = useTokens();
  const notApplicable = typeof response === 'object' && response.state === 'not_applicable'
    ? response : null;
  const notApplicableControl = step.allowNotApplicable ? <>
    <Choice label="Not applicable" onPress={() => onChange({ state: 'not_applicable', reason: '' })}
      selected={notApplicable !== null} styles={styles} />
    {notApplicable ? <TextInput accessibilityLabel={`Reason ${step.title} is not applicable`}
      maxLength={500} onChangeText={(reason) => onChange({ state: 'not_applicable', reason })}
      placeholder="Reason this step does not apply" placeholderTextColor={tokens.textMuted}
      style={styles.input} value={notApplicable.reason} /> : null}
  </> : null;
  if (step.responseKind === 'confirm') {
    return <View style={styles.responseGroup}><Choice label="Confirmed" onPress={() => onChange(true)}
      selected={response === true} styles={styles} />{notApplicableControl}</View>;
  }
  if (step.responseKind === 'pass_fail') {
    return <View style={styles.responseGroup}><View style={styles.choices}><Choice label="Pass" onPress={() => onChange(true)} selected={response === true}
      styles={styles} /><Choice label="Needs attention" onPress={() => onChange(false)} selected={response === false}
      styles={styles} /></View>{notApplicableControl}</View>;
  }
  return <View style={styles.responseGroup}><TextInput accessibilityLabel={step.title} keyboardType={step.responseKind === 'number' ? 'decimal-pad' : 'default'}
    maxLength={step.maxLength} multiline={step.responseKind === 'text'} onChangeText={(value) => {
      if (step.responseKind === 'text') onChange(value);
      else if (!value.trim()) onChange(undefined);
      else if (Number.isFinite(Number(value))) onChange(Number(value));
    }} placeholder={step.responseKind === 'number' ? 'Enter value' : 'Enter response'}
    placeholderTextColor={tokens.textMuted} style={styles.input}
    value={response === undefined || typeof response === 'object' ? '' : String(response)} />{notApplicableControl}</View>;
}

function Choice({ label, onPress, selected, styles }: {
  label: string; onPress: () => void; selected: boolean; styles: ReturnType<typeof createStyles>;
}) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress}
    style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}>
    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
  </Pressable>;
}

function IssueFields({ categories, issue, onChange, stepKey, styles }: {
  categories: readonly string[]; issue?: OperationIntentIssue; onChange: (issue: OperationIntentIssue) => void;
  stepKey: string; styles: ReturnType<typeof createStyles>;
}) {
  const tokens = useTokens();
  const category = issue?.category ?? categories[0] ?? 'other';
  const next = (changes: Partial<OperationIntentIssue>) => onChange({ category, severity: 'normal',
    description: '', stepKey, ...issue, ...changes });
  return (
    <View style={styles.issue}>
      <Text style={styles.issueTitle}>Issue details required</Text>
      {categories.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}>{categories.map((item) => <Choice key={item} label={item}
          onPress={() => next({ category: item })} selected={category === item} styles={styles} />)}</ScrollView> : null}
      <TextInput accessibilityLabel={`Issue description for ${stepKey}`} maxLength={2_000} multiline
        onChangeText={(description) => next({ description })} placeholder="Describe what needs attention"
        placeholderTextColor={tokens.textMuted} style={[styles.input, styles.note]}
        value={issue?.description ?? ''} />
    </View>
  );
}

function MissingOperation({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return <SafeAreaView style={styles.missing}><Text style={styles.title}>Operation unavailable</Text>
    <Body muted>It may have been completed, removed, or belong to another location.</Body>
    <Button label="Back to crew" onPress={() => router.back()} /></SafeAreaView>;
}

function createStyles(tokens: BrandTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: tokens.surface }, flex: { flex: 1 },
    header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: tokens.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.secondary },
    headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 17, fontWeight: '700' },
    content: { padding: tokens.spacing.lg, paddingBottom: 80, gap: tokens.spacing.lg },
    hero: { gap: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
    eyebrow: { color: tokens.accent, fontFamily: tokens.fontBody, fontSize: 12, letterSpacing: 1.2 },
    title: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 30 },
    cardTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 21 },
    claimCard: { gap: tokens.spacing.md }, stepCard: { gap: tokens.spacing.md },
    stepNumber: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, letterSpacing: 1 },
    input: { minHeight: 52, borderWidth: 1, borderColor: tokens.secondary, borderRadius: tokens.radius.md,
      color: tokens.textPrimary, backgroundColor: tokens.surface, fontFamily: tokens.fontBody,
      fontSize: 16, paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.md },
    note: { minHeight: 96, textAlignVertical: 'top' },
    responseGroup: { gap: tokens.spacing.sm },
    choices: { flexDirection: 'row', gap: tokens.spacing.sm },
    choice: { minHeight: 48, flex: 1, borderWidth: 1, borderColor: tokens.secondary,
      borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.spacing.md },
    choiceSelected: { backgroundColor: tokens.textPrimary, borderColor: tokens.textPrimary },
    choiceText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
    choiceTextSelected: { color: tokens.surfaceElevated, fontWeight: '700' },
    issue: { gap: tokens.spacing.sm, paddingTop: tokens.spacing.sm },
    issueTitle: { color: tokens.danger, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 14 },
    categoryRow: { gap: tokens.spacing.sm }, actions: { gap: tokens.spacing.md },
    error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },
    pressed: { opacity: 0.75 },
    missing: { flex: 1, backgroundColor: tokens.surface, justifyContent: 'center',
      padding: tokens.spacing.xl, gap: tokens.spacing.lg },
  });
}
