import {
  decryptToken,
  deletePaymentLink,
  loadTokenKey,
  SquareApiError,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

const BATCH_SIZE = 10;
const CONCURRENCY = 2;

type DueQuote = {
  order_id: string;
  brand_id: string;
  location_id: string;
  expires_at: string;
};

type LinkOrder = {
  id: string;
  status: string;
  tender_type: string;
  square_payment_link_id: string | null;
};

type Connection = {
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
};

export type DueSquareLink = DueQuote & {
  paymentLinkId: string | null;
  accessTokenEncrypted: string | null;
};

export type SquareLinkExpirySummary = {
  scanned: number;
  cancelled: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
};

type MaintenanceDeps = {
  load?: (db: SupabaseClient, now: Date) => Promise<DueSquareLink[]>;
  cancel?: (square: SquareConfig, row: DueSquareLink) => Promise<void>;
  finalize?: (db: SupabaseClient, row: DueSquareLink) => Promise<boolean>;
};

async function loadDueLinks(db: SupabaseClient, now: Date): Promise<DueSquareLink[]> {
  const quotes = await db.from('platform_fee_quotes')
    .select('order_id, brand_id, location_id, expires_at')
    .lte('expires_at', now.toISOString())
    .order('expires_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<DueQuote[]>();
  if (quotes.error) throw quotes.error;
  const due = quotes.data ?? [];
  if (due.length === 0) return [];

  const orderIds = due.map((row) => row.order_id);
  const locationIds = [...new Set(due.map((row) => row.location_id))];
  const [orders, connections] = await Promise.all([
    db.from('orders')
      .select('id, status, tender_type, square_payment_link_id')
      .in('id', orderIds)
      .returns<LinkOrder[]>(),
    db.from('square_connections')
      .select('brand_id, location_id, access_token_encrypted')
      .in('location_id', locationIds)
      .returns<Connection[]>(),
  ]);
  if (orders.error) throw orders.error;
  if (connections.error) throw connections.error;
  const orderById = new Map((orders.data ?? []).map((row) => [row.id, row]));
  const connectionByTenant = new Map((connections.data ?? [])
    .map((row) => [`${row.brand_id}:${row.location_id}`, row]));
  return due.map((quote) => {
    const order = orderById.get(quote.order_id);
    const connection = connectionByTenant.get(`${quote.brand_id}:${quote.location_id}`);
    const eligible = (order?.status === 'created' || order?.status === 'cancelled')
      && order.tender_type === 'square_link';
    return {
      ...quote,
      paymentLinkId: eligible ? order.square_payment_link_id : null,
      accessTokenEncrypted: connection?.access_token_encrypted ?? null,
    };
  });
}

async function cancelLink(square: SquareConfig, row: DueSquareLink): Promise<void> {
  if (!row.paymentLinkId || !row.accessTokenEncrypted) throw new Error('Checkout cancellation data is incomplete.');
  await deletePaymentLink(
    square,
    decryptToken(row.accessTokenEncrypted, loadTokenKey()),
    row.paymentLinkId,
  );
}

async function finalizeExpiry(db: SupabaseClient, row: DueSquareLink): Promise<boolean> {
  if (!row.paymentLinkId) return false;
  const result = await db.rpc('expire_square_checkout_quote', {
    p_order_id: row.order_id,
    p_payment_link_id: row.paymentLinkId,
  });
  if (result.error) throw result.error;
  return result.data === true;
}

/** Cancel due hosted pages before atomically releasing their fee capacity. */
export async function expireDueSquareCheckoutLinks(
  db: SupabaseClient,
  square: SquareConfig,
  now: Date,
  deps: MaintenanceDeps = {},
): Promise<SquareLinkExpirySummary> {
  let rows: DueSquareLink[];
  try {
    rows = await (deps.load ?? loadDueLinks)(db, now);
  } catch (error) {
    console.error('Square checkout expiry scan failed.', {
      error: error instanceof Error ? error.message : 'database query failed',
    });
    return { scanned: 0, cancelled: 0, failed: 0, stale: 0, scanFailed: true };
  }

  const summary: SquareLinkExpirySummary = {
    scanned: rows.length, cancelled: 0, failed: 0, stale: 0, scanFailed: false,
  };
  for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
    const results = await Promise.all(rows.slice(offset, offset + CONCURRENCY).map(async (row) => {
      if (!row.paymentLinkId || !row.accessTokenEncrypted) return 'failed' as const;
      try {
        await (deps.cancel ?? cancelLink)(square, row);
      } catch (error) {
        // A stored provider id that is already absent is the retry case after
        // Square succeeded and the database response was lost. It cannot be
        // payable, so finalization is safe; every other provider error keeps
        // the reservation in place.
        if (!(error instanceof SquareApiError && error.status === 404)) return 'failed' as const;
      }
      try {
        return await (deps.finalize ?? finalizeExpiry)(db, row)
          ? 'cancelled' as const
          : 'stale' as const;
      } catch {
        return 'failed' as const;
      }
    }));
    for (const result of results) summary[result] += 1;
  }
  return summary;
}
