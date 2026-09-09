export const SQUARE_RENEWAL_RETRY_MS = 15 * 60 * 1_000;
export const SQUARE_RENEWAL_BATCH_SIZE = 10;
// One scheduled interval is long enough for a checkout or refund request that
// already resolved the old runtime to finish. The outgoing token is never used
// for new work after the connection row changes.
export const SQUARE_ACCESS_TOKEN_RETIREMENT_GRACE_MS = 5 * 60 * 1_000;
export const SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE = 10;


export type SquareRenewalConnection = {
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | null;
  updated_at: string | null;
};

export type SquareRenewalResult =
  | { outcome: 'renewed'; accessToken: string; cleanupFailed: boolean }
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
