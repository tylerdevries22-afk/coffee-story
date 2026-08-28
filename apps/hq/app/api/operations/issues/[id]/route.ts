import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors, parseJsonBody } from '@/lib/api-auth';
import { boundedText, operationDatabaseError, operationsRequestContext, validUuid } from '@/lib/operations-api';

type UpdateIssueBody = { status?: unknown; resolution?: unknown };

export function OPTIONS(): Response { return corsPreflight(); }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const context = await operationsRequestContext(request, 'location_manager');
  if (context instanceof Response) return context;
  const { id } = await params;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<UpdateIssueBody>(request);
  if (body instanceof Response) return body;
  const resolution = boundedText(body.resolution, 2_000);
  if (!validUuid(id) || !actionId || !['acknowledged', 'resolved', 'dismissed'].includes(String(body.status))
    || resolution === null || (body.status === 'resolved' && !resolution)) {
    return jsonError(400, 'invalid_request', 'Status, resolution, and Idempotency-Key are invalid.');
  }
  const result = await context.db.rpc('update_operation_issue', {
    target_issue: id, target_action_id: actionId,
    target_status: body.status, target_resolution: resolution,
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ issue: result.data });
}
