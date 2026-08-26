import { idempotencyKeyOf } from '@/lib/api-auth';
import { demoSyncStore, isDemoSyncError } from '@/lib/demo-order-sync';
import {
  demoSyncAvailable, demoSyncChannel, demoSyncError, demoSyncHeaders,
  demoSyncJson, demoSyncWriteAllowed, parseDemoSyncBody,
} from '@/lib/demo-sync-http';

export const dynamic = 'force-dynamic';
export function OPTIONS(request: Request): Response { return new Response(null, { status: 204, headers: demoSyncHeaders(request) }); }
export function GET(request: Request): Response {
  if (!demoSyncAvailable(request)) return demoSyncError(request, 404, 'not_found', 'Not found.');
  return demoSyncJson(request, demoSyncStore.snapshot());
}
export async function POST(request: Request): Promise<Response> {
  if (!demoSyncAvailable(request)) return demoSyncError(request, 404, 'not_found', 'Not found.');
  if (!demoSyncWriteAllowed(request)) return demoSyncError(request, 403, 'forbidden', 'Loopback browser origin required.');
  const key = idempotencyKeyOf(request);
  if (!key) return demoSyncError(request, 400, 'invalid_request', 'A UUID idempotency key is required.');
  const channel = demoSyncChannel(request.headers.get('x-demo-sync-channel'));
  if (!channel) return demoSyncError(request, 400, 'invalid_request', 'A valid demo channel is required.');
  const parsed = await parseDemoSyncBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const placed = demoSyncStore.place(parsed.value, key, channel);
    return demoSyncJson(request, placed.response, placed.replayed ? 200 : 201);
  } catch (error) {
    if (!isDemoSyncError(error)) throw error;
    return demoSyncError(request, error.code === 'idempotency_conflict' ? 409 : 400, error.code, error.message);
  }
}
