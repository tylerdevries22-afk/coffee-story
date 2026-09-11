import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  AppState,
  type AppStateStatus,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import type { OperationIntentQueue } from '@platform/offline';

import {
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
  type OperatorNotification,
  type OperatorTaskIssue,
  type OperatorTaskOccurrence,
} from '@/features/operations/model';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useOperator } from '@/state/operator-store';
import { operationRange } from './operations-store-helpers';
import { useOperationsActions } from './operations-actions';
import { useOperationsValue } from './operations-value';
import { OperationsContext } from './operations-context';
export { useOperations } from './operations-context';

const LIVE_REFRESH_MS = 60_000;
const CLOCK_REFRESH_MS = 30_000;

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
    const range = operationRange(current);
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
    void registerOperationPush().catch(() => undefined);
  }, [live]);

  const { claim, complete, discardConflict, release, reportIssue } = useOperationsActions({
    brandId, brandUserId, flush, isDemo, locationId, queueRef, refresh, setError,
    setIssues, setOccurrences, setQueue,
  });

  const value = useOperationsValue({
    actions: { claim, complete, discardConflict, refresh, release, reportIssue },
    enabled: operationsEnabled, error, issues, loading, notifications, now, occurrences, queue,
  });

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}
