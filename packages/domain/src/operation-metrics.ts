import { operationInstant as instant } from './operation-time';
import type { OperationOccurrence } from './operation-types';

export type EscalationRule = { id: string; offsetMinutes: number; order?: number };

export function dueEscalations(
  dueAt: string,
  rules: readonly EscalationRule[],
  alreadyCreatedRuleIds: ReadonlySet<string>,
  now: Date,
): EscalationRule[] {
  const due = instant(dueAt);
  return rules
    .filter((rule) => Number.isInteger(rule.offsetMinutes) && rule.offsetMinutes >= 0)
    .filter((rule) => !alreadyCreatedRuleIds.has(rule.id)
      && now.getTime() >= due + rule.offsetMinutes * 60_000)
    .sort((left, right) => (left.order ?? left.offsetMinutes) - (right.order ?? right.offsetMinutes));
}

export type OperationMetrics = {
  accountable: number;
  completed: number;
  completedOnTime: number;
  overdue: number;
  missed: number;
  completionRate: number | null;
  onTimeRate: number | null;
  overdueRate: number | null;
};

export function operationMetrics(occurrences: readonly OperationOccurrence[]): OperationMetrics {
  const accountableRows = occurrences.filter((item) => (
    item.status === 'completed' || item.status === 'missed'
  ));
  const completedRows = accountableRows.filter((item) => item.status === 'completed');
  const completedOnTime = completedRows.filter((item) => item.completedAt !== null
    && instant(item.completedAt) <= instant(item.dueAt)).length;
  const overdue = accountableRows.length - completedOnTime;
  const ratio = (numerator: number): number | null => accountableRows.length === 0
    ? null
    : numerator / accountableRows.length;
  return {
    accountable: accountableRows.length,
    completed: completedRows.length,
    completedOnTime,
    overdue,
    missed: occurrences.filter((item) => item.status === 'missed').length,
    completionRate: ratio(completedRows.length),
    onTimeRate: ratio(completedOnTime),
    overdueRate: ratio(overdue),
  };
}
