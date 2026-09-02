import {
  authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured, serverEnv, serviceDb,
} from '@/lib/api-auth';
import { mayCreateEnrollment } from '@platform/device-wall';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!UUID.test(id)) return jsonError(400, 'invalid_request', 'The installation id is invalid.');
  if (!auth.claims.role || !mayCreateEnrollment(auth.claims.role)) {
    return jsonError(403, 'forbidden', 'Only an owner can revoke an installation.');
  }
  let brandId = auth.claims.brand_id;
  if (auth.claims.role === 'platform_admin') {
    const installation = await db.from('device_installations').select('brand_id')
      .eq('id', id).maybeSingle<{ brand_id: string }>();
    if (installation.error || !installation.data) {
      return jsonError(404, 'installation_unavailable', 'That installation is unavailable.');
    }
    brandId = installation.data.brand_id;
  }
  const revoked = await db.rpc('revoke_device_installation', {
    p_installation_id: id, p_brand_id: brandId,
  });
  if (revoked.error) {
    return jsonError(404, 'installation_unavailable', 'That installation is unavailable.');
  }
  return jsonWithCors({ revoked: true });
}
