import { authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb } from '@/lib/api-auth';
import { createDeviceEnrollment } from '@/lib/device-wall-enrollment';
import { DeviceWallServiceError } from '@/lib/device-wall-registration';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  if (rateLimited(clientIdentity(request), 'device-wall/enroll', Date.now(), 5)) {
    return jsonError(429, 'rate_limited', 'Too many enrollment attempts. Try again shortly.');
  }
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  const body = await parseJsonBody<unknown>(request);
  if (body instanceof Response) return body;
  try { return jsonWithCors(await createDeviceEnrollment(db, auth, body), 201); }
  catch (error) {
    if (error instanceof DeviceWallServiceError) return jsonError(error.status, error.code, error.message);
    throw error;
  }
}
