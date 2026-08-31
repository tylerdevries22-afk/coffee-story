<<<<<<< ours
import {
  dueEscalations,
  type EscalationRule,
  type OperationScheduleRule,
  type OperationTemplateSnapshot,
} from '@platform/domain';

export type LocationHoursSegment = { open: string; close: string };
export type LocationHours = Partial<Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  readonly LocationHoursSegment[]
>>;

export type OperationScheduleDefinition = {
  scheduleId: string;
  timezone: string;
  rule: OperationScheduleRule;
  dueWindowMinutes: number;
  graceMinutes: number;
  locationHours: LocationHours;
};

export type GeneratedOperationWindow = {
  scheduledFor: string;
  dueAt: string;
  graceMinutes: number;
  materializationKey: string;
};

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function minutesOfDay(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new RangeError('Location hours must use 24-hour HH:MM values.');
  }
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  return hour * 60 + minute;
}

function dateParts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Schedule dates must use YYYY-MM-DD.');
  const result: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(result[0], result[1] - 1, result[2]));
  if (check.getUTCFullYear() !== result[0] || check.getUTCMonth() + 1 !== result[1]
    || check.getUTCDate() !== result[2]) throw new RangeError('Schedule date is invalid.');
  return result;
}

function addIsoDays(value: string, days: number): string {
  const [year, month, day] = dateParts(value);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function offsetMinutesAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, calendar: 'gregory', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(
    parts.find((item) => item.type === type)?.value,
  );
  const representedAsUtc = Date.UTC(
    part('year'), part('month') - 1, part('day'), part('hour'), part('minute'),
  );
  return (representedAsUtc - instant.getTime()) / 60_000;
}

function instantForLocal(date: string, minute: number, timezone: string): Date | null {
  const dateOffset = Math.floor(minute / 1_440);
  const minuteOfDay = ((minute % 1_440) + 1_440) % 1_440;
  const localDate = addIsoDays(date, dateOffset);
  const [year, month, day] = dateParts(localDate);
  const hour = Math.floor(minuteOfDay / 60);
  const localMinute = minuteOfDay % 60;
  const naive = Date.UTC(year, month - 1, day, hour, localMinute);
  let guess = naive - offsetMinutesAt(new Date(naive), timezone) * 60_000;
  guess = naive - offsetMinutesAt(new Date(guess), timezone) * 60_000;
  const result = new Date(guess);
  const rendered = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, calendar: 'gregory', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(result);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined => (
    rendered.find((item) => item.type === type)?.value
  );
  const renderedDate = `${value('year')}-${value('month')}-${value('day')}`;
  const renderedTime = `${value('hour')}:${value('minute')}`;
  return renderedDate === localDate
    && renderedTime === `${String(hour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}`
    ? result : null;
}

function serviceDayWindows(input: OperationScheduleDefinition, serviceDate: string): Date[] {
  const [year, month, day] = dateParts(serviceDate);
  const isoWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  if (!input.rule.weekdays.includes(isoWeekday)) return [];
  if (input.rule.kind === 'fixed_time') {
    const instant = instantForLocal(serviceDate, minutesOfDay(input.rule.localTime), input.timezone);
    return instant ? [instant] : [];
  }
  const segments = [...(input.locationHours[WEEKDAY_KEYS[isoWeekday - 1]!] ?? [])]
    .map((segment) => {
      const open = minutesOfDay(segment.open);
      const rawClose = minutesOfDay(segment.close);
      return { open, close: rawClose <= open ? rawClose + 1_440 : rawClose };
    })
    .sort((left, right) => left.open - right.open);
  if (segments.length === 0) return [];
  const relativeRule = input.rule;
  let localMinutes: number[];
  if (relativeRule.kind === 'opening_offset') {
    localMinutes = [segments[0]!.open + relativeRule.offsetMinutes];
  } else if (relativeRule.kind === 'closing_offset') {
    localMinutes = [segments[segments.length - 1]!.close + relativeRule.offsetMinutes];
  } else {
    localMinutes = segments.flatMap((segment) => {
      const start = segment.open + relativeRule.startOffsetMinutes;
      const end = segment.close + relativeRule.endOffsetMinutes;
      if (end < start) return [];
      const count = Math.floor((end - start) / relativeRule.intervalMinutes) + 1;
      return Array.from({ length: count }, (_, index) => start + index * relativeRule.intervalMinutes);
    });
  }
  return localMinutes.flatMap((minute) => {
    const instant = instantForLocal(serviceDate, minute, input.timezone);
    return instant ? [instant] : [];
  });
}

/** Generates a bounded, deterministic set of location-time occurrences. */
export function generateOperationWindows(
  input: OperationScheduleDefinition,
  startDate: string,
  endDate: string,
): GeneratedOperationWindow[] {
  if (!Number.isInteger(input.dueWindowMinutes)
    || input.dueWindowMinutes < 1 || input.dueWindowMinutes > 1_440) {
    throw new RangeError('dueWindowMinutes must be an integer from 1 through 1440.');
  }
  if (!Number.isInteger(input.graceMinutes)
    || input.graceMinutes < 0 || input.graceMinutes > 1_440) {
    throw new RangeError('graceMinutes must be an integer from 0 through 1440.');
  }
  const [startYear, startMonth, startDay] = dateParts(startDate);
  const [endYear, endMonth, endDay] = dateParts(endDate);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  if (dayCount < 1 || dayCount > 35) {
    throw new RangeError('Schedule generation must cover from 1 through 35 days.');
  }
  return Array.from({ length: dayCount }, (_, index) => addIsoDays(startDate, index))
    .flatMap((serviceDate) => serviceDayWindows(input, serviceDate))
    .sort((left, right) => left.getTime() - right.getTime())
    .map((scheduledFor) => ({
      scheduledFor: scheduledFor.toISOString(),
      dueAt: new Date(scheduledFor.getTime() + input.dueWindowMinutes * 60_000).toISOString(),
      graceMinutes: input.graceMinutes,
      materializationKey: `${input.scheduleId}:${Math.floor(scheduledFor.getTime() / 1_000)}`,
    }));
}
=======
import { dueEscalations, type EscalationRule } from '@platform/domain';
>>>>>>> theirs

export type MaterializableOperation = {
  scheduleId: string;
  brandId: string;
  locationId: string;
  templateId: string;
<<<<<<< ours
  templateSnapshot: OperationTemplateSnapshot;
  scheduledFor: string;
  dueAt: string;
  graceMinutes: number;
};

export function operationMaterializationKey(input: MaterializableOperation): string {
  const scheduledAt = Date.parse(input.scheduledFor);
  if (!Number.isFinite(scheduledAt)) throw new RangeError('scheduledFor must be a valid timestamp.');
  return `${input.scheduleId}:${Math.floor(scheduledAt / 1_000)}`;
}

export function operationOccurrenceInsert(input: MaterializableOperation, now = new Date()) {
  const scheduledAt = Date.parse(input.scheduledFor);
  const dueAt = Date.parse(input.dueAt);
  if (!Number.isFinite(dueAt) || dueAt <= scheduledAt) {
    throw new RangeError('dueAt must be after scheduledFor.');
  }
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0 || input.graceMinutes > 1_440) {
    throw new RangeError('graceMinutes must be an integer from 0 through 1440.');
  }
=======
  templateSnapshot: Record<string, unknown>;
  scheduledFor: string;
  dueAt: string;
};

export function operationMaterializationKey(input: MaterializableOperation): string {
  return `${input.scheduleId}:${input.scheduledFor}`;
}

export function operationOccurrenceInsert(input: MaterializableOperation) {
>>>>>>> theirs
  return {
    brand_id: input.brandId,
    location_id: input.locationId,
    schedule_id: input.scheduleId,
    template_id: input.templateId,
    source: 'schedule' as const,
    materialization_key: operationMaterializationKey(input),
    template_snapshot: input.templateSnapshot,
    scheduled_for: input.scheduledFor,
    due_at: input.dueAt,
<<<<<<< ours
    grace_minutes: input.graceMinutes,
    status: 'scheduled' as const,
=======
    status: new Date(input.scheduledFor).getTime() <= Date.now() ? 'due' as const : 'upcoming' as const,
>>>>>>> theirs
  };
}

export type EscalationCandidate = EscalationRule & {
  recipientRole: 'eligible_staff' | 'location_manager' | 'brand_owner';
<<<<<<< ours
  channels: readonly ('in_app' | 'push')[];
=======
  channels: readonly ('push' | 'sms' | 'email')[];
>>>>>>> theirs
};

export function operationEscalationsToCreate(
  dueAt: string,
  rules: readonly EscalationCandidate[],
  existingRuleIds: ReadonlySet<string>,
  now: Date,
): EscalationCandidate[] {
  const dueIds = new Set(dueEscalations(dueAt, rules, existingRuleIds, now).map((rule) => rule.id));
  return rules.filter((rule) => dueIds.has(rule.id));
}
