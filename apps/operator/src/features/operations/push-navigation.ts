const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Accepts only a task UUID; notification payloads cannot navigate elsewhere. */
export function operationNotificationOccurrenceId(data: unknown): string | null {
  const occurrenceId = record(data)?.occurrenceId;
  return typeof occurrenceId === 'string' && UUID_PATTERN.test(occurrenceId) ? occurrenceId : null;
}
