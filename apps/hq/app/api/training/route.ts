import {
  authenticate,
  corsPreflight,
  jsonError,
  jsonWithCors,
  notConfigured,
  serverEnv,
  serviceDb,
} from '../../../lib/api-auth';

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function GET(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (!auth.claims.role) return jsonError(403, 'forbidden', 'Training is available to tenant staff only.');
  const result = await db.from('training_releases')
    .select('id, version, manifest, published_at')
    .eq('brand_id', auth.claims.brand_id)
    .eq('status', 'published')
    .maybeSingle();
  if (result.error) return jsonError(500, 'training_lookup_failed', 'Could not load training.');
  return jsonWithCors(result.data ? { status: 'ready', release: result.data } : { status: 'empty', release: null });
}
