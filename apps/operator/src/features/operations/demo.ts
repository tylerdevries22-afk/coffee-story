import type { OperatorTaskOccurrence } from './model';
import { resolveActivityBoardConfig } from '@platform/domain';
import { demoOperationsEnabled, SELECTED_DEMO_TENANT } from '@/data/demo-tenant';
import { stillpointDemoOccurrences } from './stillpoint-demo';

export const DEMO_OPERATIONS_BRAND_ID = '20000000-0000-4000-8000-000000000001';

/**
 * What demo mode resolves the operations capability to.
 *
 * Named rather than inlined as `isDemo ||` so the two cases stay apart: this
 * is a fixture that makes the shift board reviewable with no database, and it
 * is never consulted by a signed-in session. A live session that has not been
 * told the module is installed -- including one whose staff-context load
 * failed -- resolves false.
 */
export const DEMO_OPERATIONS_ENABLED = demoOperationsEnabled();
const DEMO_LOCATION_IDS: Readonly<Record<string, string>> = {
  'loc-uptown': '20000000-0000-4000-8000-000000000002',
  'loc-downtown': '20000000-0000-4000-8000-000000000003',
};

export function demoOperationLocationId(locationKey: string): string {
  return DEMO_LOCATION_IDS[locationKey] ?? '20000000-0000-4000-8000-000000000004';
}

function instant(now: Date, offsetMinutes: number): string {
  return new Date(now.getTime() + offsetMinutes * 60_000).toISOString();
}

/** A tenant-neutral demo exercises due, upcoming, and training-blocked states. */
export function demoOperationOccurrences(locationKey: string, now: Date): OperatorTaskOccurrence[] {
  const locationId = demoOperationLocationId(locationKey);
  if (resolveActivityBoardConfig(SELECTED_DEMO_TENANT?.brandConfig).enabled) {
    return stillpointDemoOccurrences(DEMO_OPERATIONS_BRAND_ID, locationId, now);
  }
  return [
    {
      id: '20000000-0000-4000-8000-000000000010',
      brandId: DEMO_OPERATIONS_BRAND_ID,
      locationId,
      status: 'scheduled',
      scheduledFor: instant(now, -8),
      dueAt: instant(now, 7),
      graceMinutes: 5,
      claimedBy: null,
      completedAt: null,
      completedBy: null,
      completionNote: '',
      actorName: null,
      snapshot: {
        templateId: '20000000-0000-4000-8000-000000000020',
        templateKey: 'guest-area-hourly',
        revision: 1,
        title: 'Guest area hourly check',
        instructions: 'Place safety signage before beginning and reopen the area after the final check.',
        estimatedMinutes: 10,
        requiredRoleIds: ['floor-team'],
        requiredRoleLabels: ['Floor team'],
        requiredCompetencyKeys: ['sanitation-basics'],
        issueCategories: ['hazard', 'fixture', 'supplies'],
        steps: [
          { key: 'signage', title: 'Safety signage is in place', instructions: '', responseKind: 'confirm', required: true, issueOnFailure: false },
          { key: 'hazards', title: 'Area is free of immediate hazards', instructions: 'Report any hazard before completion.', responseKind: 'pass_fail', required: true, issueOnFailure: true },
          { key: 'supplies', title: 'Required supplies are stocked', instructions: '', responseKind: 'pass_fail', required: true, issueOnFailure: true },
          { key: 'touchpoints', title: 'Fixtures and touchpoints are sanitized', instructions: '', responseKind: 'confirm', required: true, issueOnFailure: false },
          { key: 'note', title: 'Optional handoff note', instructions: '', responseKind: 'text', required: false, issueOnFailure: false, maxLength: 500 },
        ],
      },
      eligibility: { eligible: true, hasActiveShift: true, missingRoles: [], missingCompetencies: [] },
    },
    {
      id: '20000000-0000-4000-8000-000000000011',
      brandId: DEMO_OPERATIONS_BRAND_ID,
      locationId,
      status: 'scheduled',
      scheduledFor: instant(now, 52),
      dueAt: instant(now, 67),
      graceMinutes: 5,
      claimedBy: null,
      completedAt: null,
      completedBy: null,
      completionNote: '',
      actorName: null,
      snapshot: {
        templateId: '20000000-0000-4000-8000-000000000020',
        templateKey: 'guest-area-hourly',
        revision: 1,
        title: 'Guest area hourly check',
        instructions: 'Review the full checklist when the occurrence becomes due.',
        estimatedMinutes: 10,
        requiredRoleIds: ['floor-team'],
        requiredRoleLabels: ['Floor team'],
        requiredCompetencyKeys: ['sanitation-basics'],
        issueCategories: ['hazard', 'fixture', 'supplies'],
        steps: [],
      },
      eligibility: { eligible: true, hasActiveShift: true, missingRoles: [], missingCompetencies: [] },
    },
    {
      id: '20000000-0000-4000-8000-000000000012',
      brandId: DEMO_OPERATIONS_BRAND_ID,
      locationId,
      status: 'scheduled',
      scheduledFor: instant(now, -3),
      dueAt: instant(now, 27),
      graceMinutes: 5,
      claimedBy: null,
      completedAt: null,
      completedBy: null,
      completionNote: '',
      actorName: null,
      snapshot: {
        templateId: '20000000-0000-4000-8000-000000000021',
        templateKey: 'equipment-safety',
        revision: 1,
        title: 'Equipment safety check',
        instructions: 'Complete the safety module before taking responsibility for this task.',
        estimatedMinutes: 5,
        requiredRoleIds: ['shift-lead'],
        requiredRoleLabels: ['Shift lead'],
        requiredCompetencyKeys: ['equipment-safety'],
        issueCategories: ['equipment'],
        steps: [],
      },
      eligibility: {
        eligible: false,
        hasActiveShift: true,
        missingRoles: [],
        missingCompetencies: ['Equipment safety'],
      },
    },
  ];
}
