import type { SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export type DueSquareCard = {
  orderId: string;
  brandId: string;
  locationId: string;
  expiresAt: string;
  claimGeneration: string;
  squareOrderId: string | null;
  squarePaymentId: string | null;
  squareLocationId: string | null;
  grossCents: number | null;
  providerOrderTotalCents: number | null;
  expectedFeeCents: number | null;
  feeBpsApplied: number | null;
  accessTokenEncrypted: string | null;
  valid: boolean;
};

export type CardExpiryEvidence = {
  kind: 'unpaid';
  squareOrderId: string;
  providerOrderVersion: number;
  providerOrderState: 'CANCELED';
  squarePaymentId: string | null;
  providerPaymentState: 'FAILED' | 'CANCELED' | null;
};

export type CardInspection = CardExpiryEvidence | {
  kind: 'payment';
  paymentId: string;
  feeCents: number;
};

export type SquareCardExpirySummary = {
  scanned: number;
  reconciled: number;
  expired: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
};

export type CardMaintenanceDeps = {
  load?: (db: SupabaseClient, now: Date) => Promise<DueSquareCard[]>;
  recover?: (
    db: SupabaseClient, square: SquareConfig, row: DueSquareCard,
  ) => Promise<DueSquareCard>;
  inspect?: (square: SquareConfig, row: DueSquareCard) => Promise<CardInspection>;
  reconcile?: (
    db: SupabaseClient, row: DueSquareCard, result: CardInspection,
  ) => Promise<boolean>;
  expire?: (
    db: SupabaseClient, row: DueSquareCard, result: CardExpiryEvidence,
  ) => Promise<boolean>;
};
