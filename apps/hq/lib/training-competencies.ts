import { createHash } from 'node:crypto';

const COMPETENCY_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;

export type CompetencyGrantLesson = {
  grantsCompetencyKeys?: readonly string[];
  competencyValidityDays?: number;
};

export type CompetencyGrantPlan = {
  keys: string[];
  expiresAt: string;
};

export function trainingCompetencyGrantPlan(
  lesson: CompetencyGrantLesson,
  passed: boolean,
  now = new Date(),
): CompetencyGrantPlan | null {
  if (!passed || !Array.isArray(lesson.grantsCompetencyKeys)
    || lesson.grantsCompetencyKeys.length === 0) return null;
  const keys = [...new Set(lesson.grantsCompetencyKeys)];
  const validityDays = lesson.competencyValidityDays ?? 365;
  if (keys.length > 20 || keys.some((key) => !COMPETENCY_KEY.test(key))
    || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3_650) return null;
  return {
    keys,
    expiresAt: new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1_000).toISOString(),
  };
}

/** Stable per-attempt/per-competency UUID for database idempotency receipts. */
export function competencyAwardActionId(attemptId: string, competencyKey: string): string {
  const bytes = createHash('sha256').update(`${attemptId}:${competencyKey}`, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
