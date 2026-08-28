import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors, parseJsonBody } from '../../../../lib/api-auth';
import {
  operationChildActionId,
  operationDatabaseError,
  operationsRequestContext,
  validNotificationIds,
} from '../../../../lib/operations-api';

type AcknowledgeBody = { ids?: unknown };

const COLUMNS = 'id,occurrence_id,title,body,created_at,read_at';

export function OPTIONS(): Response { return corsPreflight(); }

export async function GET(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const result = await context.db.from('operation_operator_notifications').select(COLUMNS)
    .eq('brand_id', context.auth.claims.brand_id)
    .order('created_at', { ascending: false }).limit(200);
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ notifications: result.data ?? [] });
}

export async function PATCH(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const rootActionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<AcknowledgeBody>(request);
  if (body instanceof Response) return body;
  const ids = body && typeof body === 'object' && !Array.isArray(body)
    ? validNotificationIds(body.ids)
    : null;
  if (!rootActionId || !ids) {
    return jsonError(400, 'invalid_request', 'One to 100 unique notification IDs and an Idempotency-Key are required.');
  }
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10).map((id) => ({
      id,
      actionId: operationChildActionId(rootActionId, id),
    }));
    if (batch.some((item) => item.actionId === null)) {
      return jsonError(400, 'invalid_request', 'The acknowledgement identity is invalid.');
    }
    const results = await Promise.all(batch.map((item) => context.db.rpc(
      'acknowledge_operation_notification',
      { target_notification: item.id, target_action_id: item.actionId as string },
    )));
    const failed = results.find((result) => result.error)?.error;
    if (failed) return operationDatabaseError(failed);
  }
  return jsonWithCors({ acknowledged: ids.length });
}
