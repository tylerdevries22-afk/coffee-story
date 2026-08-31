import { buildCsv } from './csv';

const STATUS_VALUES = ['scheduled', 'claimed', 'completed', 'missed', 'cancelled'] as const;

export type OperationReportFilters = {
  from: string;
  to: string;
  locationId: string | null;
  status: typeof STATUS_VALUES[number] | null;
  issueType: string | null;
};

export type OperationReportRow = {
  occurrenceId: string;
  locationName: string;
  program: string;
  routine: string;
  status: string;
  scheduledFor: string;
  dueAt: string;
  completedAt: string | null;
  issueTypes: readonly string[];
};

/** An explicit report filter wins; otherwise the export follows the workspace. */
export function operationReportLocationId(
  requestedLocationId: string | null,
  workspaceLocationId: string | null,
): string | null {
  return requestedLocationId ?? workspaceLocationId;
}

export function operationReportFilters(
  searchParams: URLSearchParams,
  now = new Date(),
): OperationReportFilters | null {
  const fromValue = searchParams.get('from')
    ?? new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000).toISOString();
  const toValue = searchParams.get('to') ?? now.toISOString();
  const fromMs = Date.parse(fromValue);
  const toMs = Date.parse(toValue);
  const statusValue = searchParams.get('status');
  const locationId = searchParams.get('locationId');
  const issueType = searchParams.get('issueType');
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs
    || toMs - fromMs > 366 * 24 * 60 * 60 * 1_000
    || (statusValue !== null && !STATUS_VALUES.includes(statusValue as typeof STATUS_VALUES[number]))
    || (locationId !== null && !/^[0-9a-f-]{36}$/i.test(locationId))
    || (issueType !== null && (issueType.length < 1 || issueType.length > 80))) return null;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    locationId,
    status: statusValue as OperationReportFilters['status'],
    issueType,
  };
}

export function operationReportCsv(rows: readonly OperationReportRow[]): string {
  return buildCsv(
    ['occurrence_id', 'location', 'program', 'routine', 'status', 'scheduled_for',
      'due_at', 'completed_at', 'issue_types'],
    rows.map((row) => [
      row.occurrenceId,
      row.locationName,
      row.program,
      row.routine,
      row.status,
      row.scheduledFor,
      row.dueAt,
      row.completedAt ?? '',
      row.issueTypes.join('|'),
    ]),
  );
}
