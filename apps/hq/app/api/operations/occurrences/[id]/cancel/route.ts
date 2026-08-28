import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors, parseJsonBody } from '@/lib/api-auth';
import { boundedText, operationDatabaseError, operationsRequestContext, validUuid } from '@/lib/operations-api';

type CancelBody = { reason?: unknown };

export function OPTIONS(): Response { return corsPreflight(); }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const context = await operationsRequestContext(request, 'location_manager');
  if (context instanceof Response) return context;
  const { id } = await params;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<CancelBody>(request);
  if (body instanceof Response) return body;
  const reason = boundedText(body.reason, 500, true);
  if (!validUuid(id) || !actionId || !reason || reason.length < 3) {
    return jsonError(400, 'invalid_request', 'A valid occurrence, reason, and Idempotency-Key are required.');
  }
  const result = await context.db.rpc('cancel_operation_occurrence', {
    target_occurrence: id, target_action_id: actionId, target_reason: reason,
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ occurrence: result.data });
}
