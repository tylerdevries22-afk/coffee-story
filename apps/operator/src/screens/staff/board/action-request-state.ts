/**
 * The order detail sheet's lifecycle for a cancel or refund it just fired.
 *
 * The bug this replaces: the sheet called `operator.cancel`/`operator.refund`
 * without awaiting anything and closed itself on the same tick, so a refund
 * Square rejected looked identical, on screen, to one that succeeded. This
 * state machine gives the sheet somewhere to sit between "tapped" and
 * "confirmed" -- staying open and pending until the action resolves, then
 * either closing (success) or showing the failure with a retry (error).
 */
export type ActionKind = 'cancel' | 'refund';

export type ActionRequestState =
  | { phase: 'idle' }
  | { phase: 'pending'; kind: ActionKind }
  | { phase: 'error'; kind: ActionKind; message: string };

export const idleActionRequest: ActionRequestState = { phase: 'idle' };

export function actionStarted(kind: ActionKind): ActionRequestState {
  return { phase: 'pending', kind };
}

export function actionSucceeded(): ActionRequestState {
  return idleActionRequest;
}

export function actionFailed(kind: ActionKind, message: string): ActionRequestState {
  return { phase: 'error', kind, message };
}

export function actionDismissed(): ActionRequestState {
  return idleActionRequest;
}

/** True while a request from this sheet has not yet resolved, so callers can
 * disable the other destructive controls and stop a second tap from racing
 * the first. */
export function isActionPending(state: ActionRequestState): boolean {
  return state.phase === 'pending';
}
