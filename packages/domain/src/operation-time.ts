export function operationInstant(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError(`Invalid operation timestamp: ${value}`);
  return milliseconds;
}
