export const SQUARE_RENEWAL_RETRY_MS = 15 * 60 * 1_000;
export const SQUARE_RENEWAL_BATCH_SIZE = 10;

export type SquareRenewalConnection = {
  id: string;
  connection_generation: string;
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | null;
  updated_at: string | null;
};

export type SquareRenewalResult =
  | { outcome: 'renewed'; accessToken: string; connectionGeneration: string; cleanupFailed: boolean }
  | { outcome: 'failed'; cleanupFailed: boolean }
  | { outcome: 'stale'; stage: 'claim' | 'persist'; cleanupFailed: boolean };

export type SquareRenewalSummary = {
  scanned: number;
  renewed: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
  cleanupFailed: number;
};

export function squareRenewalBackoffActive(
  updatedAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!updatedAt) return false;
  const lastAttempt = Date.parse(updatedAt);
  return Number.isFinite(lastAttempt) && nowMs - lastAttempt < SQUARE_RENEWAL_RETRY_MS;
}
