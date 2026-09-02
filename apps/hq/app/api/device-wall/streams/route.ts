import { authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb } from '@/lib/api-auth';
import { DeviceWallServiceError } from '@/lib/device-wall-registration';
import { authorizeDeviceStream, endDeviceStream } from '@/lib/device-wall-streams';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

async function context(request: Request) {
  const env = serverEnv();
  if (!env) return { error: notConfigured() };
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return { error: auth };
  return { db, auth };
}

export async function POST(request: Request) {
  if (rateLimited(clientIdentity(request), 'device-wall/streams', Date.now(), 8)) {
    return jsonError(429, 'rate_limited', 'Too many stream requests. Try again shortly.');
  }
  const ctx = await context(request);
  if ('error' in ctx) return ctx.error;
  const body = await parseJsonBody<{ installationId?: unknown; brandId?: unknown }>(request);
  if (body instanceof Response) return body;
  try { return jsonWithCors(await authorizeDeviceStream(ctx.db, ctx.auth, body), 201); }
  catch (error) {
    if (error instanceof DeviceWallServiceError) return jsonError(error.status, error.code, error.message);
    throw error;
  }
}

export async function DELETE(request: Request) {
  const ctx = await context(request);
  if ('error' in ctx) return ctx.error;
  const body = await parseJsonBody<{ sessionId?: unknown }>(request);
  if (body instanceof Response) return body;
  if (typeof body.sessionId !== 'string') return jsonError(400, 'invalid_request', 'sessionId is required.');
  try { return jsonWithCors(await endDeviceStream(ctx.db, ctx.auth, body.sessionId)); }
  catch (error) {
    if (error instanceof DeviceWallServiceError) return jsonError(error.status, error.code, error.message);
    throw error;
  }
}
