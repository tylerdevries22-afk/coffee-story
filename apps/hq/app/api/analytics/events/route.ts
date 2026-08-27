import { randomUUID } from 'node:crypto';

import { AnalyticsContractError, parseAnalyticsBatch } from '@platform/analytics';

import {
  AnalyticsIngestionError,
  analyticsRowsFor,
  analyticsRpcEventsFor,
  type TelemetryScope,
} from '../../../../lib/analytics-ingestion';
import { analyticsOriginAllowed } from '../../../../lib/analytics-origin';
import {
  authenticateAny,
  CORS_HEADERS,
  idempotencyKeyOf,
  notConfigured,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';

const MAX_BODY_BYTES = 512 * 1024;

function errorResponse(
  request: Request,
  status: number,
  code: string,
  message: string,
  correlationId: string,
  retryable = false,
): Response {
  return Response.json({ error: { code, message, correlationId, retryable } }, {
    status,
    headers: analyticsCorsHeaders(request),
  });
}

function analyticsCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? new URL(request.url).origin;
  return { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function withAnalyticsCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(analyticsCorsHeaders(request))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

export function OPTIONS(request: Request): Response {
  if (!analyticsOriginAllowed(request.url, request.headers.get('origin'), process.env.ANALYTICS_ALLOWED_ORIGINS)) {
    return errorResponse(request, 403, 'origin_forbidden', 'This web origin is not allowed.', randomUUID());
  }
  return new Response(null, { status: 204, headers: analyticsCorsHeaders(request) });
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = randomUUID();
  if (!analyticsOriginAllowed(request.url, request.headers.get('origin'), process.env.ANALYTICS_ALLOWED_ORIGINS)) {
    return errorResponse(request, 403, 'origin_forbidden', 'This web origin is not allowed.', correlationId);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(request, 413, 'payload_too_large', 'Analytics batches are limited to 512 KiB.', correlationId);
  }
  const batchKey = idempotencyKeyOf(request);
  if (batchKey === false || batchKey === null) {
    return errorResponse(request, 428, 'idempotency_key_required', 'Send a UUID Idempotency-Key for each batch.', correlationId);
  }
  const env = serverEnv();
  if (!env) return withAnalyticsCors(notConfigured(), request);
  const db = serviceDb(env);
  const caller = await authenticateAny(request, db);
  if (caller instanceof Response) return withAnalyticsCors(caller, request);
  let rawBody: unknown;
  try {
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
      return errorResponse(request, 413, 'payload_too_large', 'Analytics batches are limited to 512 KiB.', correlationId);
    }
    rawBody = JSON.parse(rawText) as unknown;
  } catch {
    return errorResponse(request, 400, 'invalid_request', 'The request body must be valid JSON.', correlationId);
  }

  let batch;
  try {
    batch = parseAnalyticsBatch(rawBody);
  } catch (error) {
    const code = error instanceof AnalyticsContractError ? error.code.toLowerCase() : 'invalid_event';
    return errorResponse(request, 400, code, 'The analytics batch does not match the published contract.', correlationId);
  }

  const brandId = caller.kind === 'device' ? caller.device.brand_id : caller.claims.brand_id;
  const locationQuery = await db.from('locations').select('id').eq('brand_id', brandId)
    .returns<{ id: string }[]>();
  if (locationQuery.error) {
    return errorResponse(request, 503, 'tenant_scope_unavailable', 'Could not verify tenant locations.', correlationId, true);
  }
  const tenantLocationIds = new Set((locationQuery.data ?? []).map((location) => location.id));
  const scope: TelemetryScope = caller.kind === 'device'
    ? {
        brandId,
        kind: 'device',
        deviceRole: caller.device.role,
        deviceLocationId: caller.device.location_id,
        allowedLocationIds: tenantLocationIds,
      }
    : {
        brandId,
        kind: 'user',
        role: caller.claims.role ?? 'customer',
        allowedLocationIds: caller.claims.role === 'staff' || caller.claims.role === 'location_manager'
          ? new Set(caller.claims.location_ids.filter((id) => tenantLocationIds.has(id)))
          : tenantLocationIds,
      };

  let rows;
  try {
    rows = analyticsRowsFor(batch, scope, new Date());
  } catch (error) {
    const code = error instanceof AnalyticsIngestionError ? error.code : 'invalid_scope';
    return errorResponse(request, 403, code, 'The analytics batch is outside this caller’s tenant scope.', correlationId);
  }
  const surface = rows[0]?.surface;
  if (!surface || rows.some((row) => row.surface !== surface)) {
    return errorResponse(request, 400, 'mixed_surfaces', 'Each analytics batch must contain one app surface.', correlationId);
  }

  const result = await db.rpc('ingest_analytics_batch', {
    brand: brandId,
    surface,
    batch_key: batchKey,
    correlation: correlationId,
    events: analyticsRpcEventsFor(rows),
  });
  if (result.error) {
    if (result.error.message.includes('analytics_rate_limited')) {
      return errorResponse(request, 429, 'rate_limited', 'Analytics ingestion is temporarily rate limited.', correlationId, true);
    }
    if (result.error.message.includes('analytics_')) {
      return errorResponse(request, 400, 'invalid_batch', 'The analytics batch failed database validation.', correlationId);
    }
    return errorResponse(request, 503, 'ingestion_unavailable', 'Analytics ingestion is temporarily unavailable.', correlationId, true);
  }
  return Response.json({ status: 'accepted', correlationId, result: result.data }, {
    status: 202,
    headers: analyticsCorsHeaders(request),
  });
}
