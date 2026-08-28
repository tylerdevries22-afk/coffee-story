import { corsPreflight, jsonError, jsonWithCors } from '@/lib/api-auth';
import { operationsRequestContext, validOperationsRange, validUuid } from '@/lib/operations-api';

const OCCURRENCE_COLUMNS = [
  'id', 'brand_id', 'location_id', 'schedule_id', 'template_id', 'source',
  'materialization_key', 'template_snapshot', 'scheduled_for', 'due_at',
  'grace_minutes', 'status', 'claimed_by', 'claimed_at', 'claim_expires_at',
  'completed_at', 'completion_note', 'created_at', 'updated_at',
].join(',');
const ISSUE_COLUMNS = [
  'id', 'occurrence_id', 'category', 'severity', 'description', 'step_key', 'status',
].join(',');

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function GET(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const url = new URL(request.url);
  const locationId = url.searchParams.get('locationId');
  const range = validOperationsRange(url.searchParams.get('from'), url.searchParams.get('to'));
  if (!validUuid(locationId) || !range) {
    return jsonError(400, 'invalid_request', 'A valid locationId and a date range of at most 36 days are required.');
  }
  const [occurrences, issues] = await Promise.all([
    context.db.from('operation_occurrences').select(OCCURRENCE_COLUMNS)
      .eq('brand_id', context.auth.claims.brand_id).eq('location_id', locationId)
      .gte('scheduled_for', range.from).lte('scheduled_for', range.to)
      .order('scheduled_for').limit(1_000),
    context.db.from('operation_issues').select(ISSUE_COLUMNS)
      .eq('brand_id', context.auth.claims.brand_id).eq('location_id', locationId)
      .in('status', ['open', 'acknowledged']).order('created_at', { ascending: false }).limit(500),
  ]);
  if (occurrences.error || issues.error) {
    return jsonError(503, 'queue_unavailable', 'The operations queue is temporarily unavailable.');
  }
  return jsonWithCors({ occurrences: occurrences.data ?? [], issues: issues.data ?? [], range });
}
