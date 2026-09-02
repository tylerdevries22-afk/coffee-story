import { authenticateAny, corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb } from '@/lib/api-auth';
import { DeviceWallServiceError, registerInstallation } from '@/lib/device-wall-registration';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  if (rateLimited(clientIdentity(request), 'device-wall/register', Date.now(), 12)) {
    return jsonError(429, 'rate_limited', 'Too many registration attempts. Try again shortly.');
  }
  const db = serviceDb(env);
  const caller = await authenticateAny(request, db);
  if (caller instanceof Response) return caller;
  const body = await parseJsonBody<unknown>(request);
  if (body instanceof Response) return body;
  try { return jsonWithCors(await registerInstallation(db, caller, body), 201); }
  catch (error) {
    if (error instanceof DeviceWallServiceError) return jsonError(error.status, error.code, error.message);
    throw error;
  }
}
