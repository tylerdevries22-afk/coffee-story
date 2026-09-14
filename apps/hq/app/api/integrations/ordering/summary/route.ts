/**
 * GET /api/integrations/ordering/summary?brandId=<uuid>
 *
 * One brand's ordering summary for an external platform surface -- the Elevate
 * portal's Ordering tab. Authorization is the database's, not this route's:
 * public.caller_brand_ordering_summary resolves the caller from auth.uid() and
 * requires the brand to hold a live integration enrollment, so this handler
 * cannot widen access by getting its own check wrong.
 *
 * The read goes through authenticatedDb, never serviceDb. serviceDb here would
 * make the RPC's caller the service role and defeat both of those gates.
 */
import { CORS_HEADERS, corsPreflight, jsonError } from '../../../../../lib/api-auth';
import {
  integrationContext, orderingSummaryFrom, integrationRequestId,
  type OrderingSummaryRow,
} from '../../../../../lib/integration-summary';
import { log } from '../../../../../lib/log';

export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

export async function GET(request: Request): Promise<Response> {
  const context = await integrationContext(request);
  if (context instanceof Response) return context;
  const requestId = integrationRequestId();

  const result = await context.db.rpc('caller_brand_ordering_summary', {
    p_brand_id: context.brandId,
  });
  if (result.error) {
    // The function raises one message for "not a platform admin" and for "that
    // brand is not enrolled", on purpose: two distinguishable failures would
    // let a caller enumerate which brands exist on the platform. This route
    // keeps them indistinguishable too.
    if (result.error.message.includes('ordering_summary_denied')) {
      log.warn('integration.ordering_summary.denied', {
        requestId, actorId: context.userId, brandId: context.brandId,
      });
      return jsonError(403, 'forbidden', 'That brand is not available to this integration.');
    }
    log.error('integration.ordering_summary.failed', {
      requestId, actorId: context.userId, brandId: context.brandId,
    }, result.error);
    return jsonError(503, 'summary_unavailable', 'The ordering summary is unavailable right now.');
  }

  const rows = (result.data ?? []) as OrderingSummaryRow[];
  log.info('integration.ordering_summary.read', {
    requestId, actorId: context.userId, brandId: context.brandId, locations: rows.length,
  });
  const body = orderingSummaryFrom(context.brandId, rows, new Date().toISOString());
  // no-store, never s-maxage: authorization lives in headers while a shared
  // edge cache keys on the URL, so a cached copy would be served to whoever
  // guessed the brandId. Caching belongs in the caller, behind its own auth.
  return Response.json(body, {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' },
  });
}
