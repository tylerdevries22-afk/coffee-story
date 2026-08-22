// Staged replacement for src/features/rewards/presentation.ts
import type { RewardEntry } from '@/types/domain';

import { TENANT } from '@/tenant';

export const HEART_POINTS_LABEL = TENANT.copy.pointsName ?? 'Points';

export type RewardProgress = {
  currentFloor: number;
  nextThreshold: number;
  completed: number;
  remaining: number;
  ratio: number;
};

export function rewardProgress(
  annualPoints: number,
  currentFloor: number,
  nextThreshold: number,
): RewardProgress {
  const safePoints = Math.max(0, annualPoints);
  const safeFloor = Math.max(0, currentFloor);
  const safeThreshold = Math.max(safeFloor + 1, nextThreshold);
  const completed = Math.max(0, safePoints - safeFloor);
  const span = safeThreshold - safeFloor;
  return {
    currentFloor: safeFloor,
    nextThreshold: safeThreshold,
    completed,
    remaining: Math.max(0, safeThreshold - safePoints),
    ratio: Math.min(1, completed / span),
  };
}

export function referralShareUrl(baseUrl: string, referralCode: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const normalizedCode = referralCode.trim().toUpperCase();
  if (!normalizedBase || !normalizedCode) {
    throw new RangeError('A base URL and referral code are required.');
  }
  return `${normalizedBase}/?ref=${encodeURIComponent(normalizedCode)}`;
}

export function demoReferralCode(profileId: string): string {
  const normalized = profileId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `BEAN-${(normalized || 'GUEST').slice(-8).padStart(8, '0')}`;
}

export function cashDeltaForEntry(entry: RewardEntry): number | null {
  if (entry.entryType !== 'redemption') return null;
  const match = /\$(\d+(?:\.\d{1,2})?)/.exec(entry.description);
  return match ? Math.round(Number(match[1]) * 100) : null;
}

export function formatRewardDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function annualPeriodYear(periodStart: string): number {
  const match = /^(\d{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.exec(periodStart.trim());
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}
