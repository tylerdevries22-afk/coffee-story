import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  AppState,
  type AppStateStatus,
} from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { newIdempotencyKey } from '@platform/api-client';
import {
  OPERATION_INTENT_VERSION,
  createOperationIntentQueue,
  enqueueOperationIntent,
  removeOperationIntent,
  type OperationIntent,
  type OperationIntentQueue,
  type OperationIntentIssue,
  type OperationIssueSeverity,
} from '@platform/offline';

import {
  type CompletionDraft,
  loadOperationNotifications,
  loadOperatorQueue,
  submitOperationIntent,
} from '@/features/operations/api';
import {
  DEMO_OPERATIONS_BRAND_ID,
  demoOperationLocationId,
  demoOperationOccurrences,
} from '@/features/operations/demo';
import {
  loadOperationIntents,
  saveOperationIntents,
} from '@/features/operations/persistent-intents';
import {
  drainOperationIntents,
  operationIntentFailure,
} from '@/features/operations/reconcile';
import { operationNotificationReadBus } from '@/features/operations/notification-reads';
import { registerOperationPush } from '@/features/operations/push';
import {
  displayStatusForTask,
  type OperatorNotification,
  type OperatorTaskIssue,
  type OperatorTaskOccurrence,
} from '@/features/operations/model';
import { supabase } from '@/lib/supabase';
import {
  DISABLED_OPERATIONS,
  type OperationConflict,
  type OperationsState,
} from '@/state/operations-state';
import { useAuth } from '@/state/auth-context';
import { useOperator } from '@/state/operator-store';

const LIVE_REFRESH_MS = 60_000;
const CLOCK_REFRESH_MS = 30_000;

const OperationsContext = createContext<OperationsState | null>(null);

function rangeFor(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
    to: new Date(now.getTime() + 35 * 24 * 60 * 60_000).toISOString(),
  };
}

function actionBase(
  brandId: string,
  locationId: string,
  occurrenceId: string,
): Pick<OperationIntent, 'version' | 'actionId' | 'brandId' | 'locationId' | 'occurrenceId' | 'createdAt'> {
  return {
    version: OPERATION_INTENT_VERSION,
    actionId: newIdempotencyKey(),
    brandId,
    locationId,
    occurrenceId,
    createdAt: new Date().toISOString(),
  };
}

function optimisticTask(
  task: OperatorTaskOccurrence,
  intent: OperationIntent,
  actorId: string,
): OperatorTaskOccurrence {
  if (task.id !== intent.occurrenceId) return task;
  if (intent.kind === 'claim') {
    return {
      ...task,
      status: 'claimed',
      claimedBy: actorId,
      claimedAt: intent.createdAt,
    };
  }
  if (intent.kind === 'release') {
    return { ...task, status: 'scheduled', claimedBy: null, claimedAt: null, claimExpiresAt: null };
  }
  if (intent.kind === 'complete') {
    return {
      ...task,
      status: 'completed',
      completedAt: intent.createdAt,
      completedBy: actorId,
      completionNote: intent.note,
    };
  }
  return task;
}

function conflictList(queue: OperationIntentQueue): OperationConflict[] {
  return queue.records.flatMap((record) => record.status === 'conflict' ? [{
    actionId: record.intent.actionId,
    occurrenceId: record.intent.occurrenceId,
    message: record.conflict.message,
  }] : []);
}

export function OperationsProvider({ children }: PropsWithChildren) {
  const { brandUserId, isDemo, operationsEnabled, tenant } = useAuth();
  const { location, locationReady } = useOperator();
  const brandId = isDemo ? DEMO_OPERATIONS_BRAND_ID : tenant?.brand_id ?? null;
  const locationId = isDemo ? demoOperationLocationId(location.id) : location.id;
  const live = !isDemo && operationsEnabled && locationReady && brandId !== null;
  const [now, setNow] = useState(() => new Date());
  const [occurrences, setOccurrences] = useState<readonly OperatorTaskOccurrence[]>(() => (
    isDemo ? demoOperationOccurrences(location.id, new Date()) : []
  ));
  const [issues, setIssues] = useState<readonly OperatorTaskIssue[]>([]);
  const [notifications, setNotifications] = useState<readonly OperatorNotification[]>([]);
  const [queue, setQueue] = useState<OperationIntentQueue | null>(null);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<OperationIntentQueue | null>(null);
  const flushInFlight = useRef(false);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => operationNotificationReadBus.subscribe((readIds) => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((notification) => (
      readIds.has(notification.id) && notification.readAt === null
        ? { ...notification, readAt }
        : notification
    )));
  }), []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isDemo) return;
    setOccurrences(demoOperationOccurrences(location.id, new Date()));
    setIssues([]);
    setNotifications([]);
    setQueue(null);
    setLoading(false);
    setError(null);
  }, [isDemo, location.id]);

  const refresh = useCallback(async () => {
    if (isDemo) return;
    if (!operationsEnabled || !locationReady || !brandId) {
      setOccurrences([]);
      setIssues([]);
      setNotifications([]);
      setLoading(false);
      return;
    }
    const current = new Date();
    const range = rangeFor(current);
    try {
      const [snapshot, persistedNotifications] = await Promise.all([
        loadOperatorQueue(locationId, range.from, range.to),
        loadOperationNotifications().catch(() => []),
      ]);
      setOccurrences(snapshot.occurrences);
      setIssues(snapshot.issues);
      setNotifications(persistedNotifications);
      setError(null);
      setNow(current);
    } catch (loadError) {
      setError(loadError instanceof Error
        ? loadError.message
        : 'Shift tasks could not be refreshed. Your last downloaded queue is still available.');
    } finally {
      setLoading(false);
    }
  }, [brandId, isDemo, locationId, locationReady, operationsEnabled]);

  const flush = useCallback(async () => {
    const current = queueRef.current;
    if (!live || !current || current.records.length === 0 || flushInFlight.current) return;
    flushInFlight.current = true;
    try {
      const next = await drainOperationIntents(current, async (intent) => {
        try {
          await submitOperationIntent(intent);
          return { outcome: 'confirmed' };
        } catch (submitError) {
          return operationIntentFailure(submitError);
        }
      });
      queueRef.current = next;
      setQueue(next);
      await saveOperationIntents(AsyncStorage, SecureStore, next);
      if (next.records.every((record) => record.status === 'conflict')) await refresh();
    } finally {
      flushInFlight.current = false;
    }
  }, [live, refresh]);

  useEffect(() => {
    if (!live || !brandId) return undefined;
    let active = true;
    setLoading(true);
    void loadOperationIntents(AsyncStorage, SecureStore, brandId, locationId).then((stored) => {
      if (!active) return;
      queueRef.current = stored;
      setQueue(stored);
      void refresh().then(flush);
    });
    const timer = setInterval(() => void refresh().then(flush), LIVE_REFRESH_MS);
    const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void refresh().then(flush);
    });
    const database = supabase;
    const channel = database?.channel(`operator-operations:${locationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'operations_change_signals',
        filter: `location_id=eq.${locationId}`,
      }, () => void refresh())
      .subscribe();
    return () => {
      active = false;
      clearInterval(timer);
      appState.remove();
      if (channel && database) void database.removeChannel(channel);
    };
  }, [brandId, flush, live, locationId, refresh]);

  useEffect(() => {
    if (!live) return;
    void registerOperationPush().catch(() => {
      // Push is supplemental; the persisted in-app feed remains available.
    });
  }, [live]);

  const enqueue = useCallback(async (intent: OperationIntent) => {
    const actorId = brandUserId ?? 'demo-member';
    setOccurrences((current) => current.map((task) => optimisticTask(task, intent, actorId)));
    if (isDemo) {
      if (intent.kind === 'report_issue') {
        setIssues((current) => [...current, {
          id: intent.actionId,
          occurrenceId: intent.occurrenceId,
          category: intent.category,
          severity: intent.severity,
          description: intent.description,
          stepKey: intent.stepKey,
          status: 'open',
        }]);
      }
      return;
    }
    const current = queueRef.current ?? createOperationIntentQueue(intent.brandId, intent.locationId);
    const next = enqueueOperationIntent(current, intent);
    queueRef.current = next;
    setQueue(next);
    const saved = await saveOperationIntents(AsyncStorage, SecureStore, next);
    if (!saved) setError('This action could not be saved offline. Keep the app open and try again.');
    await flush();
  }, [brandUserId, flush, isDemo]);

  const claim = useCallback(async (occurrenceId: string) => {
    if (!brandId) return;
    await enqueue({ ...actionBase(brandId, locationId, occurrenceId), kind: 'claim' });
  }, [brandId, enqueue, locationId]);

  const release = useCallback(async (occurrenceId: string) => {
    if (!brandId) return;
    await enqueue({ ...actionBase(brandId, locationId, occurrenceId), kind: 'release' });
  }, [brandId, enqueue, locationId]);

  const complete = useCallback(async (occurrenceId: string, draft: CompletionDraft) => {
    if (!brandId) return;
    const pendingClaim = queueRef.current?.records.find((record) => record.status === 'pending'
      && record.intent.kind === 'claim' && record.intent.occurrenceId === occurrenceId);
    await enqueue({
      ...actionBase(brandId, locationId, occurrenceId),
      kind: 'complete',
      claimActionId: pendingClaim?.intent.actionId ?? null,
      responses: draft.responses,
      note: draft.note,
      issues: draft.issues,
    });
  }, [brandId, enqueue, locationId]);

  const reportIssue = useCallback(async (
    occurrenceId: string,
    issue: OperationIntentIssue,
  ) => {
    if (!brandId) return;
    await enqueue({
      ...actionBase(brandId, locationId, occurrenceId),
      kind: 'report_issue',
      category: issue.category,
      severity: issue.severity as OperationIssueSeverity,
      description: issue.description,
      stepKey: issue.stepKey,
    });
  }, [brandId, enqueue, locationId]);

  const discardConflict = useCallback(async (actionId: string) => {
    const current = queueRef.current;
    if (!current) return;
    const next = removeOperationIntent(current, actionId);
    queueRef.current = next;
    setQueue(next);
    await saveOperationIntents(AsyncStorage, SecureStore, next);
    await refresh();
  }, [refresh]);

  const visibleOccurrences = useMemo(() => [...occurrences].sort((left, right) => {
    const rank = { overdue: 0, claimed: 1, scheduled: 2, missed: 3, completed: 4, cancelled: 5 } as const;
    return rank[displayStatusForTask(left, now)] - rank[displayStatusForTask(right, now)]
      || Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor);
  }), [now, occurrences]);
  const conflicts = useMemo(() => queue ? conflictList(queue) : [], [queue]);
  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;
  const pendingCount = queue?.records.filter((record) => record.status === 'pending').length ?? 0;
  const value = useMemo<OperationsState>(() => ({
    // `operationsEnabled` has already resolved the demo case (auth-context);
    // re-adding `isDemo ||` here would restore the fail-open sentence one
    // layer down, where it would survive any fix made to the other.
    enabled: operationsEnabled,
    occurrences: visibleOccurrences,
    issues,
    notifications,
    unreadCount,
    pendingCount,
    conflicts,
    loading,
    error,
    now,
    refresh,
    claim,
    release,
    complete,
    reportIssue,
    discardConflict,
  }), [claim, complete, conflicts, error, issues, loading, notifications, now, operationsEnabled,
    pendingCount, refresh, release, reportIssue, discardConflict, unreadCount, visibleOccurrences]);

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

/**
 * No provider means the tenant has no `workforce-operations` installation, so
 * the answer is the denied one rather than a thrown error. See
 * DISABLED_OPERATIONS for why a crash was the wrong failure mode once the
 * staff layout started gating the mount on capability.
 *
 * `useOptionalOperations` used to exist for callers that wanted to tolerate a
 * missing provider. Every caller wants that now, so it is the only behaviour.
 */
export function useOperations(): OperationsState {
  return useContext(OperationsContext) ?? DISABLED_OPERATIONS;
}
