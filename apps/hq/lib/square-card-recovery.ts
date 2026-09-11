import {
  buildSquareBalanceLine,
  createSquareOrder,
  decryptToken,
  loadTokenKey,
  squareUsdCents,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DueSquareCard } from './square-card-maintenance-types';

/** Recover a CreateOrder response lost before its provider identity was bound. */
export async function recoverDueSquareCard(
  db: SupabaseClient,
  square: SquareConfig,
  row: DueSquareCard,
): Promise<DueSquareCard> {
  if (row.squareOrderId) return row;
  if (!row.valid || row.squarePaymentId || !row.squareLocationId
    || !row.accessTokenEncrypted || row.providerOrderTotalCents === null) {
    throw new Error('Square card recovery data is incomplete.');
  }
  const token = decryptToken(row.accessTokenEncrypted, loadTokenKey());
  const response = await createSquareOrder(square, token, {
    squareLocationId: row.squareLocationId,
    referenceId: row.orderId,
    lines: buildSquareBalanceLine(row.providerOrderTotalCents),
    taxCents: 0,
    taxLabel: 'Sales Tax',
    storedValueCents: 0,
  });
  const order = response.order;
  if (!order?.id || order.location_id !== row.squareLocationId
    || order.reference_id !== row.orderId
    || squareUsdCents(order.total_money) !== row.providerOrderTotalCents) {
    throw new Error('Square card replay identity mismatch.');
  }
  const bound = await db.rpc('bind_square_payment_attempt', {
    p_order_id: row.orderId,
    p_claim_generation: row.claimGeneration,
    p_square_order_id: order.id,
  });
  if (bound.error) throw bound.error;
  if (bound.data !== true) throw new Error('Stale Square card cleanup lease.');
  return { ...row, squareOrderId: order.id };
}
