import {
  decryptToken,
  deletePaymentLink,
  loadTokenKey,
  retrieveSquareOrder,
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
  square_order_id: string | null;
};

type Connection = {
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
};

export type DueSquareLink = DueQuote & {
  paymentLinkId: string | null;
  squareOrderId: string | null;
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
  load?: (db: SupabaseClient, now: Date, afterOrderId?: string) => Promise<DueSquareLink[]>;
  cancel?: (square: SquareConfig, row: DueSquareLink) => Promise<boolean>;
  finalize?: (db: SupabaseClient, row: DueSquareLink) => Promise<boolean>;
};

async function loadDueLinks(
  db: SupabaseClient,
  now: Date,
  afterOrderId?: string,
): Promise<DueSquareLink[]> {
  let query = db.from('platform_fee_quotes')
    .select('order_id, brand_id, location_id, expires_at')
    .lte('expires_at', now.toISOString())
    .order('order_id', { ascending: true })
    .limit(BATCH_SIZE);
  if (afterOrderId) query = query.gt('order_id', afterOrderId);
  const quotes = await query.returns<DueQuote[]>();
  if (quotes.error) throw quotes.error;
  const due = quotes.data ?? [];
  if (due.length === 0) return [];

  const orderIds = due.map((row) => row.order_id);
  const locationIds = [...new Set(due.map((row) => row.location_id))];
  const [orders, connections] = await Promise.all([
    db.from('orders')
      .select('id, status, tender_type, square_payment_link_id, square_order_id')
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
      squareOrderId: eligible ? order.square_order_id : null,
      accessTokenEncrypted: connection?.access_token_encrypted ?? null,
    };
  });
}

async function cancelLink(square: SquareConfig, row: DueSquareLink): Promise<boolean> {
  if (!row.paymentLinkId || !row.squareOrderId || !row.accessTokenEncrypted) {
    throw new Error('Checkout cancellation data is incomplete.');
  }
  const token = decryptToken(row.accessTokenEncrypted, loadTokenKey());
  try {
    const deleted = await deletePaymentLink(square, token, row.paymentLinkId);
    return deleted.id === row.paymentLinkId
      && deleted.cancelled_order_id === row.squareOrderId;
  } catch (error) {
    if (!(error instanceof SquareApiError && error.status === 404)) throw error;
    const retrieved = await retrieveSquareOrder(square, token, row.squareOrderId);
    return retrieved.order?.id === row.squareOrderId
      && retrieved.order.state === 'CANCELED'
      && (retrieved.order.tenders?.length ?? 0) === 0;
  }
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
  const summary: SquareLinkExpirySummary = {
    scanned: 0, cancelled: 0, failed: 0, stale: 0, scanFailed: false,
  };
  let afterOrderId: string | undefined;
  while (true) {
    let rows: DueSquareLink[];
    try {
      rows = await (deps.load ?? loadDueLinks)(db, now, afterOrderId);
    } catch (error) {
      console.error('Square checkout expiry scan failed.', {
        error: error instanceof Error ? error.message : 'database query failed',
      });
      summary.scanFailed = true;
      break;
    }
    summary.scanned += rows.length;
    for (let offset = 0; offset < rows.length; offset += CONCURRENCY) {
      const results = await Promise.all(rows.slice(offset, offset + CONCURRENCY).map(async (row) => {
        if (!row.paymentLinkId || !row.squareOrderId || !row.accessTokenEncrypted) {
          return 'failed' as const;
        }
        try {
          const providerCancelled = await (deps.cancel ?? cancelLink)(square, row);
          if (!providerCancelled) return 'failed' as const;
        } catch { return 'failed' as const; }
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
    if (rows.length < BATCH_SIZE) break;
    const nextOrderId = rows.at(-1)?.order_id;
    if (!nextOrderId || nextOrderId === afterOrderId) {
      summary.scanFailed = true;
      break;
    }
    afterOrderId = nextOrderId;
  }
  return summary;
}
