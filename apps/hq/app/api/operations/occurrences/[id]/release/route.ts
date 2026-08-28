import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors } from '@/lib/api-auth';
import { operationDatabaseError, operationsRequestContext, validUuid } from '@/lib/operations-api';

export function OPTIONS(): Response { return corsPreflight(); }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const { id } = await params;
  const actionId = idempotencyKeyOf(request);
  if (!validUuid(id) || !actionId) {
    return jsonError(400, 'invalid_request', 'A valid occurrence and Idempotency-Key are required.');
  }
  const result = await context.db.rpc('release_operation_occurrence', {
    target_occurrence: id, target_action_id: actionId,
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ occurrence: result.data });
}
