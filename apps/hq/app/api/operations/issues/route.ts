import { corsPreflight, idempotencyKeyOf, jsonError, jsonWithCors, parseJsonBody } from '@/lib/api-auth';
import { boundedText, operationDatabaseError, operationsRequestContext, validUuid } from '@/lib/operations-api';

type CreateIssueBody = {
  occurrenceId?: unknown;
  category?: unknown;
  severity?: unknown;
  description?: unknown;
  stepKey?: unknown;
};

const ISSUE_COLUMNS = 'id,brand_id,location_id,occurrence_id,step_key,category,severity,description,status,reported_by,resolved_by,resolved_at,resolution,created_at,updated_at';
const SEVERITIES = new Set(['low', 'normal', 'high', 'urgent']);

export function OPTIONS(): Response { return corsPreflight(); }

export async function GET(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const url = new URL(request.url);
  const locationId = url.searchParams.get('locationId');
  const status = url.searchParams.get('status');
  if (locationId !== null && !validUuid(locationId)) return jsonError(400, 'invalid_request', 'locationId is invalid.');
  if (status !== null && !['open', 'acknowledged', 'resolved', 'dismissed'].includes(status)) {
    return jsonError(400, 'invalid_request', 'status is invalid.');
  }
  let query = context.db.from('operation_issues').select(ISSUE_COLUMNS)
    .eq('brand_id', context.auth.claims.brand_id).order('created_at', { ascending: false }).limit(500);
  if (locationId) query = query.eq('location_id', locationId);
  if (status) query = query.eq('status', status);
  const result = await query;
  if (result.error) return jsonError(503, 'issues_unavailable', 'Operation issues are temporarily unavailable.');
  return jsonWithCors({ issues: result.data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<CreateIssueBody>(request);
  if (body instanceof Response) return body;
  const category = boundedText(body.category, 80, true);
  const description = boundedText(body.description, 2_000);
  const stepKey = body.stepKey === undefined ? '' : boundedText(body.stepKey, 80);
  if (!actionId || !validUuid(body.occurrenceId) || !category || !SEVERITIES.has(String(body.severity))
    || description === null || stepKey === null) {
    return jsonError(400, 'invalid_request', 'Issue details and Idempotency-Key are invalid.');
  }
  const result = await context.db.rpc('report_operation_issue', {
    target_occurrence: body.occurrenceId, target_action_id: actionId,
    target_category: category, target_severity: body.severity,
    target_description: description, target_step_key: stepKey || null,
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ issue: result.data }, 201);
}
