import type { OrderStatus } from '@platform/schema';
import { idempotencyKeyOf } from '@/lib/api-auth';
import { demoSyncStore, isDemoSyncError } from '@/lib/demo-order-sync';
import {
  demoSyncAvailable, demoSyncChannel, demoSyncError, demoSyncHeaders, demoSyncJson,
  demoSyncWriteAllowed, parseDemoSyncBody,
} from '@/lib/demo-sync-http';

const STATUSES: readonly OrderStatus[] = ['created', 'paid', 'in_progress', 'ready', 'picked_up', 'cancelled', 'refunded'];
export function OPTIONS(request: Request): Response { return new Response(null, { status: 204, headers: demoSyncHeaders(request) }); }
export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }): Promise<Response> {
  if (!demoSyncAvailable(request)) return demoSyncError(request, 404, 'not_found', 'Not found.');
  if (!demoSyncWriteAllowed(request)) return demoSyncError(request, 403, 'forbidden', 'Loopback browser origin required.');
  const key = idempotencyKeyOf(request);
  if (!key) return demoSyncError(request, 400, 'invalid_request', 'A UUID idempotency key is required.');
  const channel = demoSyncChannel(request.headers.get('x-demo-sync-channel'));
  if (!channel) return demoSyncError(request, 400, 'invalid_request', 'A valid demo channel is required.');
  const parsed = await parseDemoSyncBody(request);
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.value !== 'object' || parsed.value === null || !('status' in parsed.value)
    || !STATUSES.includes(parsed.value.status as OrderStatus)) {
    return demoSyncError(request, 400, 'invalid_request', 'A valid order status is required.');
  }
  try {
    const { orderId } = await params;
    return demoSyncJson(request, demoSyncStore.transition(
      orderId,
      parsed.value.status as OrderStatus,
      channel,
      key,
    ));
  } catch (error) {
    if (!isDemoSyncError(error)) throw error;
    return demoSyncError(request, error.code === 'not_found' ? 404 : 409, error.code, error.message);
  }
}
