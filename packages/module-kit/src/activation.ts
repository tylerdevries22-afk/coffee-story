/**
 * The activation lifecycle: draft -> validating -> active -> suspended ->
 * disabled/error, with `disabled` reachable from anywhere.
 *
 * Activation is the moment a module's routes become reachable, so it is
 * deliberately pedantic: every prerequisite is a named check, the transition
 * table is data (not branches), and an illegal move returns a reason instead
 * of throwing. The checks are pure inputs so the same evaluation runs in HQ
 * when an owner toggles a module and in CI when a manifest changes.
 */
import { ACTIVATION_STATES, type ActivationState } from './types';

/**
 * `disabled` and `error` both accept `validating` (retry) and `disabled`
 * accepts `draft` (re-registration); nothing leaves `active` without passing
 * through a state a human can see.
 */
const TRANSITIONS: Readonly<Record<ActivationState, readonly ActivationState[]>> = {
  draft: ['validating', 'disabled'],
  validating: ['active', 'error', 'disabled'],
  active: ['suspended', 'disabled'],
  suspended: ['active', 'disabled'],
  disabled: ['draft'],
  error: ['validating', 'disabled'],
};

export function canTransition(from: ActivationState, to: ActivationState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export type TransitionResult =
  | { readonly kind: 'ok'; readonly state: ActivationState }
  | { readonly kind: 'illegal'; readonly from: ActivationState; readonly to: ActivationState; readonly reason: string };

export function transitionActivation(from: ActivationState, to: ActivationState): TransitionResult {
  if (from === to) {
    return { kind: 'illegal', from, to, reason: 'a module cannot transition to its own state' };
  }
  if (!canTransition(from, to)) {
    return {
      kind: 'illegal', from, to,
      reason: `${from} cannot become ${to}; allowed: ${(TRANSITIONS[from] ?? []).join(', ') || 'none'}`,
    };
  }
  return { kind: 'ok', state: to };
}

/** The prerequisites `validating -> active` must clear, in evaluation order. */
export const ACTIVATION_CHECK_IDS = [
  'dependencies', 'configuration', 'migrations', 'credentials', 'surfaces', 'hardware',
] as const;
export type ActivationCheckId = (typeof ACTIVATION_CHECK_IDS)[number];

export type ActivationCheck = {
  readonly id: ActivationCheckId;
  readonly passed: boolean;
  readonly detail: string | null;
};

export type ActivationEvaluation = {
  readonly ready: boolean;
  readonly checks: readonly ActivationCheck[];
};

/**
 * Evaluates the gate from plain facts. Callers gather the facts (resolver
 * result, config validation, migration versions, provider credential probe,
 * surface availability, hardware inventory) -- this function owns the policy
 * that all six must pass and none may be skipped.
 */
export function evaluateActivation(
  facts: Readonly<Record<ActivationCheckId, { passed: boolean; detail?: string | null }>>,
): ActivationEvaluation {
  const checks = ACTIVATION_CHECK_IDS.map((id): ActivationCheck => {
    const fact = facts[id];
    return { id, passed: fact?.passed === true, detail: fact?.detail ?? null };
  });
  return { ready: checks.every((check) => check.passed), checks };
}

/** All states are known at compile time; this exists so persisted strings re-enter safely. */
export function parseActivationState(raw: unknown): ActivationState | null {
  return typeof raw === 'string' && (ACTIVATION_STATES as readonly string[]).includes(raw)
    ? (raw as ActivationState)
    : null;
}
