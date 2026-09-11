import type { OperationRecurrence, OperationScheduleRule } from './operation-types';

export function operationRunsOnIsoWeekday(
  rule: OperationScheduleRule | OperationRecurrence,
  isoWeekday: number,
): boolean {
  if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7) return false;
  if ('frequency' in rule) return rule.frequency === 'daily' || rule.weekdays.includes(isoWeekday);
  return rule.weekdays.includes(isoWeekday);
}

function validMinuteOffset(value: number): boolean {
  return Number.isInteger(value) && value >= -1_440 && value <= 1_440;
}

export function validateOperationScheduleRule(rule: OperationScheduleRule): string[] {
  const unique = new Set(rule.weekdays);
  if (unique.size === 0) return ['Select at least one weekday.'];
  if (unique.size !== rule.weekdays.length) return ['Weekdays must not repeat.'];
  if (!rule.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
    return ['Weekdays must use ISO values from 1 (Monday) through 7 (Sunday).'];
  }
  if (rule.kind === 'fixed_time') {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.localTime)
      ? [] : ['Fixed-time schedules require a 24-hour HH:MM time.'];
  }
  if (rule.kind === 'opening_offset' || rule.kind === 'closing_offset') {
    return validMinuteOffset(rule.offsetMinutes)
      ? [] : ['Opening and closing offsets must be whole minutes from -1440 through 1440.'];
  }
  const errors: string[] = [];
  if (!Number.isInteger(rule.intervalMinutes)
    || rule.intervalMinutes < 15 || rule.intervalMinutes > 1_440) {
    errors.push('Open-hour intervals must be whole minutes from 15 through 1440.');
  }
  if (!validMinuteOffset(rule.startOffsetMinutes) || !validMinuteOffset(rule.endOffsetMinutes)) {
    errors.push('Open-hour offsets must be whole minutes from -1440 through 1440.');
  }
  return errors;
}

export function validateOperationRecurrence(rule: OperationRecurrence): string[] {
  if (rule.frequency === 'daily') return [];
  const unique = new Set(rule.weekdays);
  if (unique.size === 0) return ['Select at least one weekday.'];
  if (unique.size !== rule.weekdays.length) return ['Weekdays must not repeat.'];
  return rule.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ? [] : ['Weekdays must use ISO values from 1 (Monday) through 7 (Sunday).'];
}

export type OperationRetentionPolicy = {
  evidenceDays: number;
  issueDays: number;
  actorIdentityDays: number;
};

export function validateOperationRetention(policy: OperationRetentionPolicy): string[] {
  const fields: readonly [keyof OperationRetentionPolicy, string][] = [
    ['evidenceDays', 'Evidence retention'],
    ['issueDays', 'Issue retention'],
    ['actorIdentityDays', 'Actor identity retention'],
  ];
  return fields.flatMap(([key, label]) => Number.isInteger(policy[key])
    && policy[key] >= 30 && policy[key] <= 3650
    ? []
    : [`${label} must be between 30 and 3650 days.`]);
}
