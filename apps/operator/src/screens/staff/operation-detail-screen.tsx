import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { operationDisplayStatus, validateOperationResponses } from '@platform/domain';
import type {
  OperationIntentIssue,
  OperationIntentResponse,
} from '@platform/offline';
import { useTokens, AppIcon } from '@platform/ui';

import { Body, Button, Card } from '@/components/ui';
import { taskEligibilityMessage, taskIsActionable, type OperatorChecklistStep,
  type OperatorTaskOccurrence } from '@/features/operations/model';
import { useAuth } from '@/state/auth-context';
import { useOperations } from '@/state/operations-store';

import { IssueFields, StepResponse } from './operation-step-inputs';
import { createStyles } from './operation-detail-styles';

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
  const terminal = ['completed', 'missed', 'cancelled'].includes(task.status);
  const eligibility = taskEligibilityMessage(task);
  const unavailable = task.claimedBy !== null || !taskIsActionable(task, operations.now);
  const message = task.claimedBy !== null
    ? 'Another team member currently owns this checklist.'
    : terminal ? 'This operation is read-only because its work window has closed.'
      : upcoming ? 'This operation can be claimed when its scheduled window begins.'
      : eligibility ?? 'Claiming records ownership and keeps completion evidence attributable.';
  return (
    <Card style={styles.claimCard}>
      <Text style={styles.cardTitle}>{terminal ? 'Operation closed'
        : unavailable ? 'Not claimable yet' : 'Ready to begin?'}</Text>
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

function MissingOperation({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return <SafeAreaView style={styles.missing}><Text style={styles.title}>Operation unavailable</Text>
    <Body muted>It may have been completed, removed, or belong to another location.</Body>
    <Button label="Back to crew" onPress={() => router.back()} /></SafeAreaView>;
}
