import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { createOperationIntentQueue, enqueueOperationIntent, removeOperationIntent,
  type OperationIntent, type OperationIntentIssue, type OperationIntentQueue,
  type OperationIssueSeverity } from '@platform/offline';
import type { CompletionDraft } from '@/features/operations/api';
import type { OperatorTaskIssue, OperatorTaskOccurrence } from '@/features/operations/model';
import { saveOperationIntents } from '@/features/operations/persistent-intents';
import { operationActionBase, optimisticOperationTask } from './operations-store-helpers';

type Options = {
  brandId: string | null;
  brandUserId: string | null;
  flush: () => Promise<void>;
  isDemo: boolean;
  locationId: string;
  queueRef: MutableRefObject<OperationIntentQueue | null>;
  refresh: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIssues: Dispatch<SetStateAction<readonly OperatorTaskIssue[]>>;
  setOccurrences: Dispatch<SetStateAction<readonly OperatorTaskOccurrence[]>>;
  setQueue: Dispatch<SetStateAction<OperationIntentQueue | null>>;
};

export function useOperationsActions(options: Options) {
  const { brandId, brandUserId, flush, isDemo, locationId, queueRef, refresh,
    setError, setIssues, setOccurrences, setQueue } = options;
  const enqueue = useCallback(async (intent: OperationIntent) => {
    const actorId = brandUserId ?? 'demo-member';
    setOccurrences((current) => current.map((task) => optimisticOperationTask(task, intent, actorId)));
    if (isDemo) {
      if (intent.kind === 'report_issue') setIssues((current) => [...current, {
        id: intent.actionId, occurrenceId: intent.occurrenceId, category: intent.category,
        severity: intent.severity, description: intent.description, stepKey: intent.stepKey, status: 'open',
      }]);
      return;
    }
    const current = queueRef.current ?? createOperationIntentQueue(intent.brandId, intent.locationId);
    const next = enqueueOperationIntent(current, intent);
    queueRef.current = next;
    setQueue(next);
    const saved = await saveOperationIntents(AsyncStorage, SecureStore, next);
    if (!saved) setError('This action could not be saved offline. Keep the app open and try again.');
    await flush();
  }, [brandUserId, flush, isDemo, queueRef, setError, setIssues, setOccurrences, setQueue]);
  const claim = useCallback(async (occurrenceId: string) => {
    if (brandId) await enqueue({ ...operationActionBase(brandId, locationId, occurrenceId), kind: 'claim' });
  }, [brandId, enqueue, locationId]);
  const release = useCallback(async (occurrenceId: string) => {
    if (brandId) await enqueue({ ...operationActionBase(brandId, locationId, occurrenceId), kind: 'release' });
  }, [brandId, enqueue, locationId]);
  const complete = useCallback(async (occurrenceId: string, draft: CompletionDraft) => {
    if (!brandId) return;
    const pendingClaim = queueRef.current?.records.find((record) => record.status === 'pending'
      && record.intent.kind === 'claim' && record.intent.occurrenceId === occurrenceId);
    await enqueue({ ...operationActionBase(brandId, locationId, occurrenceId), kind: 'complete',
      claimActionId: pendingClaim?.intent.actionId ?? null, responses: draft.responses,
      note: draft.note, issues: draft.issues });
  }, [brandId, enqueue, locationId, queueRef]);
  const reportIssue = useCallback(async (occurrenceId: string, issue: OperationIntentIssue) => {
    if (!brandId) return;
    await enqueue({ ...operationActionBase(brandId, locationId, occurrenceId), kind: 'report_issue',
      category: issue.category, severity: issue.severity as OperationIssueSeverity,
      description: issue.description, stepKey: issue.stepKey });
  }, [brandId, enqueue, locationId]);
  const discardConflict = useCallback(async (actionId: string) => {
    const current = queueRef.current;
    if (!current) return;
    const next = removeOperationIntent(current, actionId);
    queueRef.current = next;
    setQueue(next);
    await saveOperationIntents(AsyncStorage, SecureStore, next);
    await refresh();
  }, [queueRef, refresh, setQueue]);
  return { claim, complete, discardConflict, release, reportIssue };
}
