import {
  CORS_HEADERS,
  corsPreflight,
  authenticate,
  jsonError,
  notConfigured,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';

/**
 * GET /api/profile/export — guest data portability package (JSON).
 * Authenticates the bearer, then runs export_customer_account_data as service role.
 */
export async function GET(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (auth.claims.role) {
    return jsonError(403, 'customer_account_required', 'Staff accounts export organization data from HQ.');
  }

  const result = await db.rpc('export_customer_account_data', { p_user_id: auth.userId });
  if (result.error || result.data == null) {
    return jsonError(503, 'export_unavailable', 'Data export is temporarily unavailable.');
  }

  const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="my-data-export.json"',
      'Cache-Control': 'no-store',
    },
  });
}

export function OPTIONS(): Response {
  return corsPreflight();
}
