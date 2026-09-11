import {
  arrayAt,
  booleanAt,
  integerAt,
  keyAt,
  objectAt,
  requiredTextAt,
  textAt,
  textList,
} from './operations-config-readers';
import type {
  TenantOperationEscalation,
  TenantOperationSchedule,
  TenantOperationScheduleRule,
} from './operations-config-types';

const RECIPIENT_ROLES = new Set(['eligible_staff', 'location_manager', 'brand_owner']);
const CHANNELS = new Set(['in_app', 'push']);
const SCHEDULE_KINDS = new Set([
  'fixed_time', 'opening_offset', 'closing_offset', 'open_interval',
]);

function nullableDate(value: unknown, path: string, errors: string[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  const result = textAt(value, path, errors);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(result) ? new Date(`${result}T00:00:00Z`) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    errors.push(`${path} must use a valid YYYY-MM-DD date.`);
  }
  return result;
}

function parseWeekdays(value: unknown, path: string, errors: string[]): number[] {
  const rows = arrayAt(value === undefined ? [1, 2, 3, 4, 5, 6, 7] : value, path, errors);
  const weekdays = rows.filter((day): day is number => Number.isInteger(day));
  if (weekdays.length === 0 || weekdays.some((day) => day < 1 || day > 7)
    || weekdays.length !== rows.length || new Set(weekdays).size !== weekdays.length) {
    errors.push(`${path} must contain unique ISO weekdays.`);
  }
  return weekdays;
}

function parseScheduleRule(value: unknown, path: string, errors: string[]): TenantOperationScheduleRule {
  const row = objectAt(value, path, errors);
  const kind = textAt(row.kind, `${path}.kind`, errors);
  const weekdays = parseWeekdays(row.weekdays, `${path}.weekdays`, errors);
  if (!SCHEDULE_KINDS.has(kind)) errors.push(`${path}.kind is unsupported.`);
  if (kind === 'fixed_time') {
    const localTime = requiredTextAt(row.localTime, `${path}.localTime`, errors);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(localTime)) {
      errors.push(`${path}.localTime must use 24-hour HH:MM time.`);
    }
    return { kind, localTime, weekdays };
  }
  if (kind === 'opening_offset' || kind === 'closing_offset') {
    return {
      kind,
      offsetMinutes: integerAt(row.offsetMinutes, `${path}.offsetMinutes`, errors, [-1440, 1440], 0),
      weekdays,
    };
  }
  return {
    kind: 'open_interval',
    intervalMinutes: integerAt(
      row.intervalMinutes,
      `${path}.intervalMinutes`,
      errors,
      [15, 1440],
      60,
    ),
    startOffsetMinutes: integerAt(
      row.startOffsetMinutes,
      `${path}.startOffsetMinutes`,
      errors,
      [-1440, 1440],
      0,
    ),
    endOffsetMinutes: integerAt(
      row.endOffsetMinutes,
      `${path}.endOffsetMinutes`,
      errors,
      [-1440, 1440],
      0,
    ),
    weekdays,
  };
}

export function parseSchedule(value: unknown, index: number, errors: string[]): TenantOperationSchedule {
  const path = `schedules[${index}]`;
  const row = objectAt(value, path, errors);
  const activeFrom = nullableDate(row.activeFrom, `${path}.activeFrom`, errors);
  const activeUntil = nullableDate(row.activeUntil, `${path}.activeUntil`, errors);
  if (activeFrom && activeUntil && activeUntil < activeFrom) {
    errors.push(`${path}.activeUntil must be on or after activeFrom.`);
  }
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    templateKey: keyAt(row.templateKey, `${path}.templateKey`, errors),
    rule: parseScheduleRule(row.rule, `${path}.rule`, errors),
    dueWindowMinutes: integerAt(row.dueWindowMinutes, `${path}.dueWindowMinutes`, errors, [1, 1440], 30),
    graceMinutes: integerAt(row.graceMinutes, `${path}.graceMinutes`, errors, [0, 1440], 10),
    activeFrom,
    activeUntil,
    enabled: booleanAt(row.enabled, `${path}.enabled`, errors, true),
  };
}

export function parseEscalation(value: unknown, index: number, errors: string[]): TenantOperationEscalation {
  const path = `escalations[${index}]`;
  const row = objectAt(value, path, errors);
  const recipientRole = textAt(row.recipientRole, `${path}.recipientRole`, errors);
  const channels = textList(row.channels, `${path}.channels`, errors);
  if (!RECIPIENT_ROLES.has(recipientRole)) errors.push(`${path}.recipientRole is unsupported.`);
  if (channels.length === 0 || channels.some((channel) => !CHANNELS.has(channel))) {
    errors.push(`${path}.channels must use in_app or push.`);
  }
  return {
    scheduleKey: row.scheduleKey === undefined || row.scheduleKey === null
      ? null : keyAt(row.scheduleKey, `${path}.scheduleKey`, errors),
    order: integerAt(row.order, `${path}.order`, errors, [1, 20], index + 1),
    offsetMinutes: integerAt(row.offsetMinutes, `${path}.offsetMinutes`, errors, [0, 43_200], 0),
    recipientRole: RECIPIENT_ROLES.has(recipientRole)
      ? recipientRole as TenantOperationEscalation['recipientRole'] : 'brand_owner',
    channels: channels.filter((channel): channel is TenantOperationEscalation['channels'][number] => CHANNELS.has(channel)),
  };
}
