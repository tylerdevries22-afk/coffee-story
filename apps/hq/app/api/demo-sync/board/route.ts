import { demoSyncBoardTickets, demoSyncStore } from '@/lib/demo-order-sync';
import {
  demoSyncAvailable, demoSyncError, demoSyncHeaders, demoSyncJson,
} from '@/lib/demo-sync-http';

export const dynamic = 'force-dynamic';

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: demoSyncHeaders(request) });
}

/** Display-safe local projection: no cart, notes, totals, or tender details. */
export function GET(request: Request): Response {
  if (!demoSyncAvailable(request)) return demoSyncError(request, 404, 'not_found', 'Not found.');
  return demoSyncJson(request, demoSyncBoardTickets(demoSyncStore.snapshot()));
}
