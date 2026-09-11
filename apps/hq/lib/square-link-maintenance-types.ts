import type { SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export type DueSquareLink = {
  order_id: string;
  brand_id: string;
  location_id: string;
  expires_at: string;
  claim_generation: string;
  checkoutUrl: string | null;
  paymentLinkId: string | null;
  squareOrderId: string | null;
  squareLocationId: string | null;
  accessTokenEncrypted: string | null;
  grossCents: number | null;
  expectedFeeCents: number | null;
  feeBpsApplied: number | null;
  valid: boolean;
};

export type LinkCancellationEvidence = {
  kind: 'cancelled';
  providerOrderVersion: number;
  providerOrderState: 'CANCELED';
};

export type LinkPaymentEvidence = {
  kind: 'payment';
  paymentId: string;
  feeCents: number;
};

export type LinkInspection = LinkCancellationEvidence | LinkPaymentEvidence;

export type SquareLinkExpirySummary = {
  scanned: number;
  cancelled: number;
  reconciled: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
};

export type LinkMaintenanceDeps = {
  load?: (db: SupabaseClient, now: Date) => Promise<DueSquareLink[]>;
  recover?: (
    db: SupabaseClient, square: SquareConfig, row: DueSquareLink,
  ) => Promise<DueSquareLink>;
  inspect?: (
    square: SquareConfig, row: DueSquareLink,
  ) => Promise<LinkInspection>;
  reconcile?: (
    db: SupabaseClient, row: DueSquareLink, evidence: LinkPaymentEvidence,
  ) => Promise<boolean>;
  finalize?: (
    db: SupabaseClient, row: DueSquareLink, evidence: LinkCancellationEvidence,
  ) => Promise<boolean>;
};
