import type { resolveKioskFlow } from '@platform/domain';

export type KioskFlow = ReturnType<typeof resolveKioskFlow>;
export type KioskDraft = Record<string, unknown>;
export type PatchKioskDraft = (next: KioskDraft) => void;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
