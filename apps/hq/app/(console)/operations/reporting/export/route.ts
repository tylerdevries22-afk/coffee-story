import { hasRole, currentSession } from '@/lib/auth';
import {
  operationReportCsv,
  operationReportFilters,
  operationReportLocationId,
} from '@/lib/operations-report';
import { serverClient } from '@/lib/supabase-server';
import { authorizedSelectedLocationId } from '@/lib/workspace-location';
import { selectedOrganizationId } from '@/lib/workspace-scope';

type OccurrenceRow = {
  id: string;
  location_id: string;
  template_snapshot: unknown;
  status: string;
  scheduled_for: string;
  due_at: string;
  completed_at: string | null;
};
type IssueRow = { occurrence_id: string; category: string };

function snapshotText(snapshot: unknown, key: 'title' | 'programKey'): string {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return '';
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export async function GET(request: Request): Promise<Response> {
  const [session, client] = await Promise.all([currentSession(), serverClient()]);
  if (!session || !client || !hasRole(session, 'location_manager')) {
    return Response.json({ error: { code: 'forbidden', message: 'Operations manager access is required.' } }, { status: 403 });
  }
  const filters = operationReportFilters(new URL(request.url).searchParams);
  if (!filters) {
    return Response.json({ error: { code: 'invalid_request', message: 'Report filters are invalid.' } }, { status: 400 });
  }
  const [brandId, workspaceLocationId] = await Promise.all([
    selectedOrganizationId(session), authorizedSelectedLocationId(),
  ]);
  const locationId = operationReportLocationId(filters.locationId, workspaceLocationId);
  const feature = await client.from('brands').select('operations').eq('id', brandId)
    .maybeSingle<{ operations: boolean }>();
  if (feature.error || !feature.data?.operations) {
    return Response.json({ error: { code: 'operations_disabled', message: 'Operations are not enabled.' } }, { status: 404 });
  }
  let occurrenceQuery = client.from('operation_occurrences')
    .select('id,location_id,template_snapshot,status,scheduled_for,due_at,completed_at')
    .eq('brand_id', brandId).gte('scheduled_for', filters.from).lte('scheduled_for', filters.to)
    .order('scheduled_for', { ascending: false }).limit(10_000);
  if (locationId) occurrenceQuery = occurrenceQuery.eq('location_id', locationId);
  if (filters.status) occurrenceQuery = occurrenceQuery.eq('status', filters.status);
  const [occurrences, locations, issues] = await Promise.all([
    occurrenceQuery.returns<OccurrenceRow[]>(),
    client.from('locations').select('id,name').eq('brand_id', brandId)
      .returns<{ id: string; name: string }[]>(),
    client.from('operation_issues').select('occurrence_id,category').eq('brand_id', brandId)
      .returns<IssueRow[]>(),
  ]);
  if (occurrences.error || locations.error || issues.error) {
    return Response.json({ error: { code: 'export_unavailable', message: 'The operations export is temporarily unavailable.' } }, { status: 503 });
  }
  const locationNames = new Map((locations.data ?? []).map((location) => [location.id, location.name]));
  const issueTypes = new Map<string, string[]>();
  for (const issue of issues.data ?? []) {
    const categories = issueTypes.get(issue.occurrence_id) ?? [];
    categories.push(issue.category);
    issueTypes.set(issue.occurrence_id, categories);
  }
  const rows = (occurrences.data ?? []).filter((row) => !filters.issueType
    || issueTypes.get(row.id)?.includes(filters.issueType)).map((row) => ({
    occurrenceId: row.id,
    locationName: locationNames.get(row.location_id) ?? 'Location',
    program: snapshotText(row.template_snapshot, 'programKey'),
    routine: snapshotText(row.template_snapshot, 'title'),
    status: row.status,
    scheduledFor: row.scheduled_for,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    issueTypes: issueTypes.get(row.id) ?? [],
  }));
  return new Response(operationReportCsv(rows), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="operations-report.csv"',
      'Content-Type': 'text/csv; charset=utf-8',
    },
  });
}
