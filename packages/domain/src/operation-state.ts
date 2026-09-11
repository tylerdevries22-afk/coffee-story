import { operationInstant as instant } from './operation-time';
import type {
  OperationDisplayStatus,
  OperationOccurrence,
  OperationStatus,
} from './operation-types';

const TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
  scheduled: ['claimed', 'missed', 'cancelled'],
  claimed: ['scheduled', 'completed', 'missed', 'cancelled'],
  completed: [],
  missed: [],
  cancelled: [],
};

export function canTransitionOperation(from: OperationStatus, to: OperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}


/** Derives presentation state without mutating the database-owned workflow state. */
export function operationDisplayStatus(
  occurrence: OperationOccurrence,
  now: Date,
): OperationDisplayStatus {
  if (['completed', 'missed', 'cancelled'].includes(occurrence.status)) return occurrence.status;
  if (now.getTime() > instant(occurrence.dueAt)) return 'overdue';
  if (occurrence.claimedBy) return 'claimed';
  return 'scheduled';
}

export type OperationRequirement = {
  roleIds: readonly string[];
  competencyKeys: readonly string[];
};

export type WorkerEligibility = {
  roleIds: readonly string[];
  competencyAwards: Readonly<Record<string, string | null>>;
};

export type OperationEligibility = {
  eligible: boolean;
  missingRoles: string[];
  missingCompetencies: string[];
};

export function operationEligibility(
  requirement: OperationRequirement,
  worker: WorkerEligibility,
  now: Date,
): OperationEligibility {
  const missingRoles = requirement.roleIds.length > 0
    && !requirement.roleIds.some((role) => worker.roleIds.includes(role))
    ? [...requirement.roleIds]
    : [];
  const missingCompetencies = requirement.competencyKeys.filter((key) => {
    if (!(key in worker.competencyAwards)) return true;
    const expiry = worker.competencyAwards[key];
    return expiry !== null && (expiry === undefined || !Number.isFinite(Date.parse(expiry))
      || Date.parse(expiry) <= now.getTime());
  });
  return {
    eligible: missingRoles.length === 0 && missingCompetencies.length === 0,
    missingRoles,
    missingCompetencies,
  };
}
