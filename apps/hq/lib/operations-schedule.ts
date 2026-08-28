export const OPERATION_SCHEDULE_KINDS = [
  'fixed_time', 'opening_offset', 'closing_offset', 'open_interval',
] as const;

export type OperationScheduleKind = typeof OPERATION_SCHEDULE_KINDS[number];
export type OperationRoutineKind = 'opening' | 'interval' | 'closing' | 'ad_hoc';

const ROUTINE_SCHEDULE_KIND: Readonly<Record<OperationRoutineKind, OperationScheduleKind>> = {
  opening: 'opening_offset',
  interval: 'open_interval',
  closing: 'closing_offset',
  ad_hoc: 'fixed_time',
};

/** Keeps routine semantics aligned with the database schedule invariant. */
export function operationScheduleKindForRoutine(routineKind: OperationRoutineKind): OperationScheduleKind {
  return ROUTINE_SCHEDULE_KIND[routineKind];
}

export type OperationScheduleRuleInput = {
  scheduleKind: OperationScheduleKind;
  localStartTime: string | null;
  anchorOffsetMinutes: number | null;
  intervalMinutes: number | null;
  intervalEndOffsetMinutes: number | null;
};

function optionalInteger(value: FormDataEntryValue | null, minimum: number, maximum: number): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/** Converts the four industry-neutral schedule shapes into one database contract. */
export function operationScheduleRule(formData: FormData): OperationScheduleRuleInput | null {
  const kindValue = formData.get('scheduleKind');
  if (!OPERATION_SCHEDULE_KINDS.includes(kindValue as OperationScheduleKind)) return null;
  const scheduleKind = kindValue as OperationScheduleKind;
  if (scheduleKind === 'fixed_time') {
    const time = formData.get('localStartTime');
    if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    return { scheduleKind, localStartTime: time, anchorOffsetMinutes: null,
      intervalMinutes: null, intervalEndOffsetMinutes: null };
  }
  const anchorOffsetMinutes = optionalInteger(formData.get('anchorOffsetMinutes'), -1_440, 1_440);
  if (anchorOffsetMinutes === null) return null;
  if (scheduleKind !== 'open_interval') {
    return { scheduleKind, localStartTime: null, anchorOffsetMinutes,
      intervalMinutes: null, intervalEndOffsetMinutes: null };
  }
  const intervalMinutes = optionalInteger(formData.get('intervalMinutes'), 15, 1_440);
  const intervalEndOffsetMinutes = optionalInteger(formData.get('intervalEndOffsetMinutes'), -1_440, 1_440);
  if (intervalMinutes === null || intervalEndOffsetMinutes === null) return null;
  return { scheduleKind, localStartTime: null, anchorOffsetMinutes,
    intervalMinutes, intervalEndOffsetMinutes };
}
