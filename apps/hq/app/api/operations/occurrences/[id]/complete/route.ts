import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors, parseJsonBody } from '@/lib/api-auth';
import { boundedText, operationDatabaseError, operationsRequestContext, validUuid } from '@/lib/operations-api';

type CompleteBody = { responses?: unknown; note?: unknown; issues?: unknown };

function issueArray(value: unknown): value is readonly Record<string, unknown>[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 20) return false;
  return value.every((issue) => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return false;
    const row = issue as Record<string, unknown>;
    return typeof row.category === 'string' && row.category.trim().length >= 1
      && row.category.length <= 80
      && ['low', 'normal', 'high', 'urgent'].includes(String(row.severity))
      && typeof row.description === 'string' && row.description.length <= 2_000
      && (row.stepKey === undefined || (typeof row.stepKey === 'string' && row.stepKey.length <= 80));
  });
}

function responseObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length <= 100
    && Object.keys(value).every((key) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(key));
}

export function OPTIONS(): Response { return corsPreflight(); }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const { id } = await params;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<CompleteBody>(request);
  if (body instanceof Response) return body;
  const note = boundedText(body.note, 2_000);
  if (!validUuid(id) || !actionId || !responseObject(body.responses) || note === null
    || !issueArray(body.issues)) {
    return jsonError(400, 'invalid_request', 'Completion evidence or Idempotency-Key is invalid.');
  }
  const result = await context.db.rpc('complete_operation_occurrence', {
    target_occurrence: id, target_action_id: actionId,
    target_responses: body.responses, target_note: note, target_issues: body.issues ?? [],
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ occurrence: result.data });
}
