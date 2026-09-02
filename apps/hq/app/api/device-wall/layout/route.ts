import { DeviceWallLayoutError, parseDeviceWallLayout } from '@platform/device-wall';

import { authenticate, authenticatedDb, corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb } from '@/lib/api-auth';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type LayoutBody = { brandId?: unknown; locationId?: unknown; layout?: unknown };

function scope(auth: Awaited<ReturnType<typeof authenticate>>, body: LayoutBody) {
  if (auth instanceof Response) return null;
  const brandId = auth.claims.role === 'platform_admin' && typeof body.brandId === 'string'
    ? body.brandId : auth.claims.brand_id;
  const locationId = body.locationId === null || body.locationId === undefined ? null : body.locationId;
  if (!UUID.test(brandId) || (locationId !== null && (typeof locationId !== 'string' || !UUID.test(locationId)))) return null;
  return { brandId, locationId };
}

export async function PUT(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  if (rateLimited(clientIdentity(request), 'device-wall/layout', Date.now(), 30)) {
    return jsonError(429, 'rate_limited', 'Too many layout updates. Try again shortly.');
  }
  const auth = await authenticate(request, serviceDb(env));
  if (auth instanceof Response) return auth;
  const body = await parseJsonBody<LayoutBody>(request);
  if (body instanceof Response) return body;
  const target = scope(auth, body);
  if (!target) return jsonError(400, 'invalid_request', 'The layout scope is invalid.');
  let layout;
  try { layout = parseDeviceWallLayout(body.layout); }
  catch (error) {
    if (error instanceof DeviceWallLayoutError) return jsonError(400, 'invalid_layout', error.message);
    throw error;
  }
  const db = authenticatedDb(env, request);
  if (!db) return jsonError(401, 'unauthorized', 'Send a Supabase access token as a Bearer token.');
  const ids = layout.map((item) => item.installationId);
  if (ids.length) {
    const visible = await db.from('device_installations').select('id').eq('brand_id', target.brandId).in('id', ids).returns<{ id: string }[]>();
    if (visible.error || visible.data?.length !== ids.length) return jsonError(403, 'forbidden', 'The layout contains an unavailable installation.');
  }
  let existingQuery = db.from('device_wall_layouts').select('id')
    .eq('brand_id', target.brandId).eq('user_id', auth.userId);
  existingQuery = target.locationId
    ? existingQuery.eq('location_id', target.locationId)
    : existingQuery.is('location_id', null);
  const existing = await existingQuery.maybeSingle<{ id: string }>();
  if (existing.error) return jsonError(400, 'layout_failed', 'The layout could not be checked.');
  const saved = existing.data
    ? await db.from('device_wall_layouts').update({ layout }).eq('id', existing.data.id)
    : await db.from('device_wall_layouts').insert({
      brand_id: target.brandId, user_id: auth.userId, location_id: target.locationId, layout,
    });
  if (saved.error) return jsonError(400, 'layout_failed', 'The layout could not be saved.');
  return jsonWithCors({ ok: true });
}
