import { existsSync, readFileSync } from 'node:fs';

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function readOptionalObjectFile(
  path: string, label: string, problems: string[],
): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = objectRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (parsed) return parsed;
  } catch {
    // Report one stable, user-safe error below.
  }
  problems.push(`${label} must contain one JSON object.`);
  return {};
}
