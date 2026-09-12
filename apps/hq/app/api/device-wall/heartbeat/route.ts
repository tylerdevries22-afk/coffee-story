import { canManageLocation } from '@platform/schema';

import { authenticateAny, corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb } from '@/lib/api-auth';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  if (rateLimited(clientIdentity(request), 'device-wall/heartbeat', Date.now(), 90)) {
    return jsonError(429, 'rate_limited', 'Heartbeat rate exceeded.');
  }
  const db = serviceDb(env);
  const caller = await authenticateAny(request, db);
  if (caller instanceof Response) return caller;
  const body = await parseJsonBody<{ installationId?: unknown; locationId?: unknown }>(request);
  if (body instanceof Response) return body;
  if (typeof body.installationId !== 'string' || !UUID.test(body.installationId)
      || typeof body.locationId !== 'string' || !UUID.test(body.locationId)) {
    return jsonError(400, 'invalid_request', 'installationId and locationId must be UUIDs.');
  }
  // A device may only ever ring in for the one location its own token names --
  // that check is a plain equality. A user caller carries no fixed location at
  // all, so the equivalent check is claims-based membership: brand-wide for an
  // owner/admin, the location_ids list otherwise. Comparing body.locationId to
  // itself here previously always passed, which let a role-less guest (a
  // customer account: a brand but no staff role, per parseTenantClaims) ring
  // in for any location it named.
  const brandId = caller.kind === 'device' ? caller.claims.brandId : caller.claims.brand_id;
  const locationId = caller.kind === 'device' ? caller.claims.locationId : body.locationId;
  const authorized = caller.kind === 'device'
    ? locationId === body.locationId
    : canManageLocation(caller.claims, body.locationId);
  if (!authorized) return jsonError(403, 'forbidden', 'That installation is unavailable.');
  const result = await db.rpc('record_device_heartbeat', {
    p_installation_id: body.installationId, p_brand_id: brandId, p_location_id: locationId,
    p_paired_device_id: caller.kind === 'device' ? caller.device.id : null,
    p_user_id: caller.kind === 'user' ? caller.userId : null,
  });
  if (result.error) return jsonError(404, 'installation_unavailable', 'That installation is unavailable.');
  return jsonWithCors({ seenAt: result.data });
}
