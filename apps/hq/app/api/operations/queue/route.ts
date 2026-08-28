import { corsPreflight, jsonError, jsonWithCors } from '../../../../lib/api-auth';
import { operationsRequestContext, validOperationsRange, validUuid } from '../../../../lib/operations-api';

const OCCURRENCE_COLUMNS = [
  'id', 'brand_id', 'location_id', 'schedule_id', 'template_id', 'source',
  'materialization_key', 'template_snapshot', 'scheduled_for', 'due_at',
  'grace_minutes', 'status', 'claimed_by', 'claimed_at', 'claim_expires_at',
  'completed_at', 'completion_note', 'created_at', 'updated_at',
].join(',');
const ISSUE_COLUMNS = [
  'id', 'occurrence_id', 'category', 'severity', 'description', 'step_key', 'status',
].join(',');
type EligibilityRow = { occurrence_id: string; eligibility: unknown };
type OccurrenceRow = {
  id: string; brand_id: string; location_id: string; schedule_id: string | null;
  template_id: string; source: string; materialization_key: string; template_snapshot: unknown;
  scheduled_for: string; due_at: string; grace_minutes: number; status: string;
  claimed_by: string | null; claimed_at: string | null; claim_expires_at: string | null;
  completed_at: string | null; completion_note: string; created_at: string; updated_at: string;
};

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
      .order('scheduled_for').limit(1_000).returns<OccurrenceRow[]>(),
    context.db.from('operation_issues').select(ISSUE_COLUMNS)
      .eq('brand_id', context.auth.claims.brand_id).eq('location_id', locationId)
      .in('status', ['open', 'acknowledged']).order('created_at', { ascending: false }).limit(500),
  ]);
  if (occurrences.error || issues.error) {
    return jsonError(503, 'queue_unavailable', 'The operations queue is temporarily unavailable.');
  }
  const occurrenceRows = occurrences.data ?? [];
  const eligibility = occurrenceRows.length === 0
    ? { data: [] as EligibilityRow[], error: null }
    : await context.db.rpc('operation_queue_eligibility', {
      target_occurrences: occurrenceRows.map((row) => row.id),
    });
  if (eligibility.error) {
    return jsonError(503, 'queue_unavailable', 'The operations queue is temporarily unavailable.');
  }
  const eligibilityRows = Array.isArray(eligibility.data) ? eligibility.data as EligibilityRow[] : [];
  const eligibilityMap = new Map(eligibilityRows
    .map((row) => [row.occurrence_id, row.eligibility]));
  return jsonWithCors({
    occurrences: occurrenceRows.map((row) => ({ ...row, eligibility: eligibilityMap.get(row.id) })),
    issues: issues.data ?? [],
    range,
  });
}
