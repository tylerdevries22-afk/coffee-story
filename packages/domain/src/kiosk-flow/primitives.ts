/**
 * The shape checks every reader shares.
 *
 * All of them answer "is this usable?" with a value or a null rather than a
 * throw, which is the whole contract of this folder: a bad field is clamped or
 * dropped, never fatal.
 */

import type { KioskFlowNote } from './types';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A trimmed non-empty string within bounds, or null. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function oneOf<T extends string, F extends T | null>(
  value: unknown,
  allowed: readonly T[],
  fallback: F,
): T | F {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function uniqueMembers<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const members: T[] = [];
  for (const candidate of value) {
    const member = oneOf(candidate, allowed, null);
    if (member && !members.includes(member)) members.push(member);
  }
  return members;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** No-op when resolving, a record when inspecting. One walk, two behaviours. */
export function note(sink: KioskFlowNote[] | null, path: string, message: string): void {
  if (sink) sink.push({ path, message });
}
