/**
 * The shape of the operations board, and what it looks like when the tenant
 * does not have the module.
 *
 * Split out of operations-store.tsx so the staff layout can decide whether to
 * mount OperationsProvider at all: the store imports the offline intent queue,
 * the push registration and the Supabase client, and a layout that only needs
 * to know the shape of the disabled answer should not have to pull any of that
 * in to get it.
 */
import type { CompletionDraft } from '@/features/operations/api';
import type {
  OperatorNotification,
  OperatorTaskIssue,
  OperatorTaskOccurrence,
} from '@/features/operations/model';
import type { OperationIntentIssue } from '@platform/offline';

export type OperationConflict = {
  actionId: string;
  occurrenceId: string;
  message: string;
};

export type OperationsState = {
  enabled: boolean;
  occurrences: readonly OperatorTaskOccurrence[];
  issues: readonly OperatorTaskIssue[];
  notifications: readonly OperatorNotification[];
  unreadCount: number;
  pendingCount: number;
  conflicts: readonly OperationConflict[];
  loading: boolean;
  error: string | null;
  now: Date;
  refresh: () => Promise<void>;
  claim: (occurrenceId: string) => Promise<void>;
  release: (occurrenceId: string) => Promise<void>;
  complete: (occurrenceId: string, draft: CompletionDraft) => Promise<void>;
  reportIssue: (
    occurrenceId: string,
    issue: OperationIntentIssue,
  ) => Promise<void>;
  discardConflict: (actionId: string) => Promise<void>;
};

/**
 * What `useOperations()` answers when no provider is mounted.
 *
 * A hard throw was the old answer, and it is the wrong one now that the mount
 * is gated on capability: a tenant without the module would crash the whole
 * staff workspace -- the orders board included -- on the first screen that
 * happens to read a task count. This denies instead. `enabled` is false, every
 * collection is empty, and the screens already branch on exactly those two
 * facts, so a brand with no installation gets a staff app with no shift board
 * rather than a red screen.
 *
 * The actions resolve without doing anything, and that is not a grant. All but
 * `refresh` need an occurrence out of `occurrences` to be reachable at all, so
 * a disabled board cannot invoke them; `refresh` is reachable from pull-to-
 * refresh, where doing nothing is the correct amount of work. Rejecting
 * instead would surface as an unhandled rejection rather than as UI, because
 * the call sites are `void operations.claim(...)`. The database remains the
 * authority either way: every one of these paths is denied by RLS for a brand
 * with no active workforce-operations installation.
 *
 * `now` is captured once, at module load. Nothing can read it -- placing a
 * task on a clock requires a task -- and a stable value keeps it out of the
 * dependency arrays that would otherwise re-render on every tick.
 */
const NO_OCCURRENCES: readonly OperatorTaskOccurrence[] = Object.freeze([]);
const NO_ISSUES: readonly OperatorTaskIssue[] = Object.freeze([]);
const NO_NOTIFICATIONS: readonly OperatorNotification[] = Object.freeze([]);
const NO_CONFLICTS: readonly OperationConflict[] = Object.freeze([]);

async function inert(): Promise<void> {
  return undefined;
}

export const DISABLED_OPERATIONS: OperationsState = Object.freeze({
  enabled: false,
  occurrences: NO_OCCURRENCES,
  issues: NO_ISSUES,
  notifications: NO_NOTIFICATIONS,
  unreadCount: 0,
  pendingCount: 0,
  conflicts: NO_CONFLICTS,
  loading: false,
  error: null,
  now: new Date(),
  refresh: inert,
  claim: inert,
  release: inert,
  complete: inert,
  reportIssue: inert,
  discardConflict: inert,
});
