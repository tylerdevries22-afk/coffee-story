import { loadTokenKey, squareConfigFromEnv } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { expireDueSquareCheckoutLinks } from './square-link-maintenance';
import { renewDueSquareConnections, retireDueSquareAccessTokens } from './square-renewal';

/** Run every Square lifecycle task from the scheduled maintenance tick. */
export async function runSquareMaintenance(db: SupabaseClient, now: Date) {
  let square;
  try {
    square = squareConfigFromEnv();
    loadTokenKey();
  } catch {
    console.warn('Square maintenance skipped: server credentials are not configured.');
    return {
      configured: false,
      scanned: 0, renewed: 0, failed: 0, stale: 0, scanFailed: false, cleanupFailed: 0,
      retirements: { scanned: 0, retired: 0, failed: 0, stale: 0, scanFailed: false },
      checkoutLinks: { scanned: 0, cancelled: 0, failed: 0, stale: 0, scanFailed: false },
    };
  }

  // Renewal runs first so checkout cleanup cannot race token rotation and send
  // a credential that this same tick has just retired.
  const renewals = await renewDueSquareConnections(db, square, now);
  const [retirements, checkoutLinks] = await Promise.all([
    retireDueSquareAccessTokens(db, square, now),
    expireDueSquareCheckoutLinks(db, square, now),
  ]);
  if (renewals.scanFailed || renewals.failed > 0 || renewals.cleanupFailed > 0
    || retirements.scanFailed || retirements.failed > 0
    || checkoutLinks.scanFailed || checkoutLinks.failed > 0) {
    console.error('Square maintenance requires attention.', {
      renewalScanFailed: renewals.scanFailed,
      renewalFailures: renewals.failed,
      credentialQueueFailures: renewals.cleanupFailed,
      retirementScanFailed: retirements.scanFailed,
      retirementFailures: retirements.failed,
      checkoutScanFailed: checkoutLinks.scanFailed,
      checkoutFailures: checkoutLinks.failed,
    });
  }
  return { configured: true, ...renewals, retirements, checkoutLinks };
}

/** Finish provider cleanup before surfacing an unrelated scheduled-job error. */
export async function waitForSquareMaintenanceBeforeRethrow(
  maintenance: Promise<unknown>,
  jobError: unknown,
): Promise<never> {
  try {
    await maintenance;
  } catch (maintenanceError) {
    console.error('Square maintenance also failed after the scheduled job failed.', maintenanceError);
  }
  throw jobError;
}
