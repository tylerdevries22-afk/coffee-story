import { useMemo } from 'react';

import type { OperationIntentQueue } from '@platform/offline';
import { displayStatusForTask, type OperatorNotification, type OperatorTaskIssue,
  type OperatorTaskOccurrence } from '@/features/operations/model';
import type { OperationsState } from '@/state/operations-state';
import { operationConflictList } from './operations-store-helpers';

type Actions = Pick<OperationsState, 'refresh' | 'claim' | 'release' | 'complete' | 'reportIssue' | 'discardConflict'>;

export function useOperationsValue({ actions, enabled, error, issues, loading, notifications,
  now, occurrences, queue }: {
  actions: Actions; enabled: boolean; error: string | null; issues: readonly OperatorTaskIssue[];
  loading: boolean; notifications: readonly OperatorNotification[]; now: Date;
  occurrences: readonly OperatorTaskOccurrence[]; queue: OperationIntentQueue | null;
}): OperationsState {
  const { claim, complete, discardConflict, refresh, release, reportIssue } = actions;
  const visibleOccurrences = useMemo(() => [...occurrences].sort((left, right) => {
    const rank = { overdue: 0, claimed: 1, scheduled: 2, missed: 3, completed: 4, cancelled: 5 } as const;
    return rank[displayStatusForTask(left, now)] - rank[displayStatusForTask(right, now)]
      || Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor);
  }), [now, occurrences]);
  const conflicts = useMemo(() => queue ? operationConflictList(queue) : [], [queue]);
  const unreadCount = notifications.filter((item) => item.readAt === null).length;
  const pendingCount = queue?.records.filter((record) => record.status === 'pending').length ?? 0;
  return useMemo(() => ({ enabled, occurrences: visibleOccurrences, issues, notifications,
    unreadCount, pendingCount, conflicts, loading, error, now, claim, complete, discardConflict,
    refresh, release, reportIssue }),
  [claim, complete, conflicts, discardConflict, enabled, error, issues, loading, notifications,
    now, pendingCount, refresh, release, reportIssue, unreadCount, visibleOccurrences]);
}
