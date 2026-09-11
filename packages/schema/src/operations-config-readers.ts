const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

export type JsonObject = Record<string, unknown>;

export function objectAt(value: unknown, path: string, errors: string[]): JsonObject {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as JsonObject;
  errors.push(`${path} must be an object.`);
  return {};
}

export function arrayAt(value: unknown, path: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  errors.push(`${path} must be an array.`);
  return [];
}

export function textAt(value: unknown, path: string, errors: string[], fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value;
  errors.push(`${path} must be text.`);
  return fallback;
}

export function requiredTextAt(value: unknown, path: string, errors: string[]): string {
  const result = textAt(value, path, errors);
  if (result.trim().length === 0) errors.push(`${path} is required.`);
  return result;
}

export function integerAt(
  value: unknown,
  path: string,
  errors: string[],
  bounds: readonly [number, number],
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && (value as number) >= bounds[0] && (value as number) <= bounds[1]) {
    return value as number;
  }
  errors.push(`${path} must be an integer from ${bounds[0]} through ${bounds[1]}.`);
  return fallback;
}

export function booleanAt(value: unknown, path: string, errors: string[], fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  errors.push(`${path} must be true or false.`);
  return fallback;
}

export function keyAt(value: unknown, path: string, errors: string[]): string {
  const key = textAt(value, path, errors);
  if (!KEY_PATTERN.test(key)) errors.push(`${path} must be a lowercase kebab-case key.`);
  return key;
}

export function textList(value: unknown, path: string, errors: string[]): string[] {
  const rows = arrayAt(value ?? [], path, errors);
  const texts = rows.filter((row): row is string => typeof row === 'string');
  if (texts.length !== rows.length) errors.push(`${path} must contain only text values.`);
  if (new Set(texts).size !== texts.length) errors.push(`${path} must not contain duplicates.`);
  return texts;
}

export function duplicateKeys(rows: readonly { key: string }[], path: string, errors: string[]): void {
  const keys = rows.map((row) => row.key);
  if (new Set(keys).size !== keys.length) errors.push(`${path} keys must be unique.`);
}
