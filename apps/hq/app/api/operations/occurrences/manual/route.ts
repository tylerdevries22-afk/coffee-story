import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors, parseJsonBody } from '@/lib/api-auth';
import { operationDatabaseError, operationsRequestContext, validIsoInstant, validUuid } from '@/lib/operations-api';

type ManualOccurrenceBody = {
  locationId?: unknown;
  templateId?: unknown;
  scheduledFor?: unknown;
  dueWindowMinutes?: unknown;
};

export function OPTIONS(): Response { return corsPreflight(); }

export async function POST(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request, 'location_manager');
  if (context instanceof Response) return context;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<ManualOccurrenceBody>(request);
  if (body instanceof Response) return body;
  const scheduledFor = body.scheduledFor ?? new Date().toISOString();
  const dueWindowMinutes = body.dueWindowMinutes ?? 30;
  if (!actionId || !validUuid(body.locationId) || !validUuid(body.templateId)
    || !validIsoInstant(scheduledFor) || !Number.isInteger(dueWindowMinutes)
    || Number(dueWindowMinutes) < 1 || Number(dueWindowMinutes) > 1_440) {
    return jsonError(400, 'invalid_request', 'Location, template, schedule time, due window, and Idempotency-Key are required.');
  }
  const result = await context.db.rpc('create_manual_operation_occurrence', {
    target_location: body.locationId,
    target_template: body.templateId,
    target_action_id: actionId,
    target_scheduled_for: scheduledFor,
    target_due_window_minutes: dueWindowMinutes,
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ occurrence: result.data }, 201);
}
