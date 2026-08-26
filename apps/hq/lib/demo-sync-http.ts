import type { ApiErrorBody } from '@platform/api-client';
import type { OrderChannel } from '@platform/schema';

const LOCAL = new Set(['localhost', '127.0.0.1']);
const CHANNELS: readonly OrderChannel[] = ['app', 'web', 'kiosk', 'pos'];
const ALLOWED_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;
const MAX_BODY_BYTES = 64 * 1_024;

export function demoSyncRuntimeEnabled(): boolean {
  return process.env.COFFEE_STORY_DEMO_SYNC === '1'
    && process.env.NODE_ENV !== 'production';
}
export function previewWallRuntimeEnabled(): boolean {
  return process.env.COFFEE_STORY_PREVIEW_WALL === '1'
    && demoSyncRuntimeEnabled();
}
export function demoSyncAvailable(request: Request): boolean {
  return demoSyncRuntimeEnabled() && LOCAL.has(new URL(request.url).hostname);
}
export function demoSyncChannel(value: string | null): OrderChannel | null {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
    ? value as OrderChannel : null;
}
export function demoSyncHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, idempotency-key, x-demo-sync-channel',
    'Access-Control-Max-Age': '600', Vary: 'Origin', 'Cache-Control': 'no-store',
  };
  if (origin && ALLOWED_ORIGIN.test(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
export function demoSyncWriteAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && ALLOWED_ORIGIN.test(origin));
}
export function demoSyncJson(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: demoSyncHeaders(request) });
}
export function demoSyncError(request: Request, status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return demoSyncJson(request, body, status);
}

export async function parseDemoSyncBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: demoSyncError(request, 413, 'payload_too_large', 'The demo request is too large.') };
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return { ok: false, response: demoSyncError(request, 413, 'payload_too_large', 'The demo request is too large.') };
    }
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: demoSyncError(request, 400, 'invalid_request', 'The request body must be JSON.') };
  }
}
