import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
<<<<<<< ours
  OPERATION_STATUSES,
  canTransitionOperation,
  diffOperationTemplates,
  dueEscalations,
  operationDisplayStatus,
  operationEligibility,
  operationMetrics,
  operationRunsOnIsoWeekday,
  validateOperationRecurrence,
  validateOperationResponses,
  validateOperationRetention,
  type ChecklistStep,
  type OperationOccurrence,
  type OperationStatus,
  type OperationTemplateSnapshot,
} from './operations';

const SCHEDULED_FOR = '2026-08-28T10:00:00.000Z';
const DUE_AT = '2026-08-28T10:30:00.000Z';

function occurrence(overrides: Partial<OperationOccurrence> = {}): OperationOccurrence {
  return {
    id: 'occurrence-1',
    status: 'scheduled',
    scheduledFor: SCHEDULED_FOR,
    dueAt: DUE_AT,
    claimedBy: null,
    completedAt: null,
    ...overrides,
  };
}

const BASE_TEMPLATE: OperationTemplateSnapshot = {
  templateId: 'template-1',
  templateKey: 'opening-round',
  programKey: 'opening',
  routineKind: 'opening',
  revision: 1,
  title: 'Opening round',
  instructions: 'Follow the approved procedure.',
  estimatedMinutes: 15,
  requiredRoleIds: ['floor'],
  requiredCompetencyKeys: ['opening-safety'],
  issueCategories: ['supply', 'repair'],
  steps: [
    { key: 'supplies', responseKind: 'pass_fail', required: true, issueOnFailure: true },
    { key: 'count', responseKind: 'number', required: true, minimum: 0, maximum: 10 },
  ],
};

describe('operation transition contract', () => {
  it('publishes every status exactly once in workflow order', () => {
    assert.deepEqual(OPERATION_STATUSES, [
      'scheduled', 'claimed', 'completed', 'missed', 'cancelled',
    ]);
    assert.equal(new Set(OPERATION_STATUSES).size, OPERATION_STATUSES.length);
  });

  it('matches the complete transition matrix', () => {
    const allowed: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
      scheduled: ['claimed', 'missed', 'cancelled'],
      claimed: ['scheduled', 'completed', 'missed', 'cancelled'],
      completed: [],
      missed: [],
      cancelled: [],
    };

    for (const from of OPERATION_STATUSES) {
      for (const to of OPERATION_STATUSES) {
        assert.equal(
          canTransitionOperation(from, to),
          allowed[from].includes(to),
          `${from} -> ${to}`,
        );
      }
    }
  });
});

describe('operationDisplayStatus', () => {
  it('derives overdue strictly after the due instant', () => {
    const item = occurrence({ graceMinutes: 10 });

    assert.equal(operationDisplayStatus(item, new Date('2026-08-28T09:59:59.999Z')), 'scheduled');
    assert.equal(operationDisplayStatus(item, new Date(SCHEDULED_FOR)), 'scheduled');
    assert.equal(operationDisplayStatus(item, new Date(DUE_AT)), 'scheduled');
    assert.equal(operationDisplayStatus(item, new Date('2026-08-28T10:30:00.001Z')), 'overdue');
  });

  it('keeps a claim visible until the overdue boundary', () => {
    const item = occurrence({ status: 'claimed', claimedBy: 'worker-1', graceMinutes: 5 });

    assert.equal(operationDisplayStatus(item, new Date(DUE_AT)), 'claimed');
    assert.equal(operationDisplayStatus(item, new Date('2026-08-28T10:30:00.001Z')), 'overdue');
  });

  it('uses the due instant when no grace is configured', () => {
    assert.equal(operationDisplayStatus(occurrence(), new Date(DUE_AT)), 'scheduled');
  });

  it('never rewrites a terminal database state for presentation', () => {
    for (const status of ['completed', 'missed', 'cancelled'] as const) {
      const item = occurrence({ status });
      assert.equal(operationDisplayStatus(item, new Date('2030-01-01T00:00:00.000Z')), status);
    }
  });

  it('rejects malformed timestamps instead of silently misclassifying work', () => {
    assert.throws(
      () => operationDisplayStatus(occurrence({ dueAt: 'not-a-timestamp' }), new Date()),
      /Invalid operation timestamp/,
    );
  });
});

describe('operationEligibility', () => {
  it('allows work with no role or competency requirements', () => {
    assert.deepEqual(
      operationEligibility(
        { roleIds: [], competencyKeys: [] },
        { roleIds: [], competencyAwards: {} },
        new Date(DUE_AT),
      ),
      { eligible: true, missingRoles: [], missingCompetencies: [] },
    );
  });

  it('treats roles as any-of and competencies as all-of', () => {
    const result = operationEligibility(
      { roleIds: ['floor', 'lead'], competencyKeys: ['safety', 'equipment'] },
      { roleIds: ['lead'], competencyAwards: { safety: null } },
      new Date(DUE_AT),
    );

    assert.deepEqual(result, {
      eligible: false,
      missingRoles: [],
      missingCompetencies: ['equipment'],
    });
  });

  it('accepts permanent and future awards but expires at the exact instant', () => {
    const requirement = { roleIds: [], competencyKeys: ['permanent', 'renewing'] };
    const now = new Date(DUE_AT);

    assert.equal(operationEligibility(requirement, {
      roleIds: [],
      competencyAwards: { permanent: null, renewing: '2026-08-28T10:30:00.001Z' },
    }, now).eligible, true);
    assert.deepEqual(operationEligibility(requirement, {
      roleIds: [],
      competencyAwards: { permanent: null, renewing: DUE_AT },
    }, now).missingCompetencies, ['renewing']);
  });

  it('fails closed on malformed competency expiry values', () => {
    const result = operationEligibility(
      { roleIds: [], competencyKeys: ['safety'] },
      { roleIds: [], competencyAwards: { safety: 'not-a-timestamp' } },
      new Date(DUE_AT),
    );

    assert.deepEqual(result.missingCompetencies, ['safety']);
    assert.equal(result.eligible, false);
  });
});

describe('validateOperationResponses', () => {
  const steps: readonly ChecklistStep[] = [
    { key: 'confirmed', responseKind: 'confirm', required: true },
    { key: 'inspection', responseKind: 'pass_fail', required: true, issueOnFailure: true },
    { key: 'temperature', responseKind: 'number', required: true, minimum: 35, maximum: 45 },
    { key: 'note', responseKind: 'text', required: true, maxLength: 12 },
    { key: 'optional-note', responseKind: 'text', required: false, maxLength: 20 },
  ];

  it('accepts inclusive constraints and a resolved failed inspection', () => {
    assert.deepEqual(validateOperationResponses(steps, {
      confirmed: true,
      inspection: false,
      temperature: 35,
      note: 'checked',
    }, new Set(['inspection'])), {
      valid: true,
      missing: [],
      invalid: [],
      unknown: [],
      unresolvedFailures: [],
    });
    assert.equal(validateOperationResponses(steps, {
      confirmed: true,
      inspection: true,
      temperature: 45,
      note: '123456789012',
    }).valid, true);
  });

  it('reports missing, invalid, unknown, and unresolved failures independently', () => {
    assert.deepEqual(validateOperationResponses(steps, {
      confirmed: false,
      inspection: false,
      temperature: 45.01,
      extra: true,
    }), {
      valid: false,
      missing: ['note'],
      invalid: ['confirmed', 'temperature'],
      unknown: ['extra'],
      unresolvedFailures: ['inspection'],
    });
  });

  it('rejects non-finite numbers and blank or oversized required text', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.deepEqual(validateOperationResponses([
        { key: 'reading', responseKind: 'number', required: true },
      ], { reading: value }).invalid, ['reading']);
    }
    for (const value of ['', '   ', '1234567890123']) {
      assert.deepEqual(validateOperationResponses([
        { key: 'note', responseKind: 'text', required: true, maxLength: 12 },
      ], { note: value }).invalid, ['note']);
    }
  });

  it('allows an omitted or empty optional text response within its bound', () => {
    const optional: readonly ChecklistStep[] = [
      { key: 'note', responseKind: 'text', required: false, maxLength: 2 },
    ];

    assert.equal(validateOperationResponses(optional, {}).valid, true);
    assert.equal(validateOperationResponses(optional, { note: '' }).valid, true);
    assert.deepEqual(validateOperationResponses(optional, { note: 'abc' }).invalid, ['note']);
  });

  it('accepts a reasoned not-applicable response only for conditional steps', () => {
    const conditional = { key: 'trash', responseKind: 'confirm' as const, required: true,
      allowNotApplicable: true };
    assert.equal(validateOperationResponses([conditional], {
      trash: { state: 'not_applicable', reason: 'No bin at this location.' },
    }).valid, true);
    assert.deepEqual(validateOperationResponses([conditional], {
      trash: { state: 'not_applicable', reason: '' },
    }).invalid, ['trash']);
    assert.deepEqual(validateOperationResponses([{ ...conditional, allowNotApplicable: false }], {
      trash: { state: 'not_applicable', reason: 'No bin.' },
    }).invalid, ['trash']);
  });
});

describe('dueEscalations', () => {
  it('selects the exact boundary, excludes prior deliveries, and orders stages', () => {
    const rules = [
      { id: 'owner', offsetMinutes: 60, order: 3 },
      { id: 'staff', offsetMinutes: 0, order: 1 },
      { id: 'manager', offsetMinutes: 15, order: 2 },
    ];

    assert.deepEqual(
      dueEscalations(DUE_AT, rules, new Set(['staff']), new Date('2026-08-28T10:45:00.000Z'))
        .map((rule) => rule.id),
      ['manager'],
    );
  });

  it('ignores negative, fractional, and not-yet-due offsets', () => {
    const result = dueEscalations(DUE_AT, [
      { id: 'negative', offsetMinutes: -1 },
      { id: 'fractional', offsetMinutes: 0.5 },
      { id: 'future', offsetMinutes: 1 },
      { id: 'now', offsetMinutes: 0 },
    ], new Set(), new Date(DUE_AT));

    assert.deepEqual(result.map((rule) => rule.id), ['now']);
  });

  it('rejects an invalid due timestamp', () => {
    assert.throws(
      () => dueEscalations('invalid', [], new Set(), new Date()),
      /Invalid operation timestamp/,
    );
  });
});

describe('operationMetrics', () => {
  it('uses completed and missed occurrences as the accountable denominator', () => {
    const rows = [
      occurrence({ id: 'on-time', status: 'completed', completedAt: DUE_AT }),
      occurrence({ id: 'late', status: 'completed', completedAt: '2026-08-28T10:30:00.001Z' }),
      occurrence({ id: 'missed', status: 'missed' }),
      occurrence({ id: 'cancelled', status: 'cancelled' }),
      occurrence({ id: 'scheduled', status: 'scheduled' }),
    ];

    assert.deepEqual(operationMetrics(rows), {
      accountable: 3,
      completed: 2,
      completedOnTime: 1,
      overdue: 2,
      missed: 1,
      completionRate: 2 / 3,
      onTimeRate: 1 / 3,
      overdueRate: 2 / 3,
    });
  });

  it('does not use the miss grace period to redefine an on-time completion', () => {
    const metrics = operationMetrics([
      occurrence({
        status: 'completed',
        graceMinutes: 10,
        completedAt: '2026-08-28T10:40:00.000Z',
      }),
    ]);

    assert.equal(metrics.completedOnTime, 0);
    assert.equal(metrics.overdue, 1);
  });

  it('returns null rates when no occurrence is yet accountable', () => {
    assert.deepEqual(operationMetrics([
      occurrence({ status: 'scheduled' }),
      occurrence({ status: 'cancelled' }),
    ]), {
      accountable: 0,
      completed: 0,
      completedOnTime: 0,
      overdue: 0,
      missed: 0,
      completionRate: null,
      onTimeRate: null,
      overdueRate: null,
    });
  });
});

describe('operation recurrence', () => {
  it('runs daily on valid ISO weekdays and never on invalid values', () => {
    for (let day = -1; day <= 9; day += 1) {
      assert.equal(operationRunsOnIsoWeekday({ frequency: 'daily' }, day), day >= 1 && day <= 7);
    }
    assert.equal(operationRunsOnIsoWeekday({ frequency: 'daily' }, 1.5), false);
  });

  it('runs weekly only on selected ISO weekdays', () => {
    const recurrence = { frequency: 'weekly' as const, weekdays: [1, 3, 7] };
    assert.deepEqual(
      Array.from({ length: 7 }, (_, index) => operationRunsOnIsoWeekday(recurrence, index + 1)),
      [true, false, true, false, false, false, true],
    );
  });

  it('validates empty, repeated, fractional, and out-of-range weekdays', () => {
    assert.deepEqual(validateOperationRecurrence({ frequency: 'daily' }), []);
    assert.deepEqual(validateOperationRecurrence({ frequency: 'weekly', weekdays: [] }), [
      'Select at least one weekday.',
    ]);
    assert.deepEqual(validateOperationRecurrence({ frequency: 'weekly', weekdays: [1, 1] }), [
      'Weekdays must not repeat.',
    ]);
    for (const weekdays of [[0], [8], [1.5]]) {
      assert.deepEqual(validateOperationRecurrence({ frequency: 'weekly', weekdays }), [
        'Weekdays must use ISO values from 1 (Monday) through 7 (Sunday).',
      ]);
    }
    assert.deepEqual(validateOperationRecurrence({ frequency: 'weekly', weekdays: [7, 1, 4] }), []);
  });
});

describe('validateOperationRetention', () => {
  it('accepts both inclusive retention boundaries', () => {
    assert.deepEqual(validateOperationRetention({
      evidenceDays: 30,
      issueDays: 3650,
      actorIdentityDays: 30,
    }), []);
  });

  it('reports every invalid field in stable field order', () => {
    assert.deepEqual(validateOperationRetention({
      evidenceDays: 29,
      issueDays: 3651,
      actorIdentityDays: 30.5,
    }), [
      'Evidence retention must be between 30 and 3650 days.',
      'Issue retention must be between 30 and 3650 days.',
      'Actor identity retention must be between 30 and 3650 days.',
    ]);
  });
});

describe('diffOperationTemplates', () => {
  it('reports every editable field and ignores identity metadata', () => {
    const location = { ...BASE_TEMPLATE, templateId: 'location-template', revision: 9 };

    assert.deepEqual(diffOperationTemplates(BASE_TEMPLATE, location), [
      { field: 'title', changed: false },
      { field: 'instructions', changed: false },
      { field: 'estimatedMinutes', changed: false },
      { field: 'requiredRoleIds', changed: false },
      { field: 'requiredCompetencyKeys', changed: false },
      { field: 'issueCategories', changed: false },
      { field: 'steps', changed: false },
    ]);
  });

  it('isolates each changed field and treats ordered definitions as ordered', () => {
    const changes: Readonly<Record<string, Partial<OperationTemplateSnapshot>>> = {
      title: { title: 'Local opening round' },
      instructions: { instructions: 'Use the local procedure.' },
      estimatedMinutes: { estimatedMinutes: 20 },
      requiredRoleIds: { requiredRoleIds: ['lead'] },
      requiredCompetencyKeys: { requiredCompetencyKeys: ['local-safety'] },
      issueCategories: { issueCategories: ['repair', 'supply'] },
      steps: { steps: [...BASE_TEMPLATE.steps].reverse() },
    };

    for (const [field, override] of Object.entries(changes)) {
      const changed = diffOperationTemplates(BASE_TEMPLATE, { ...BASE_TEMPLATE, ...override })
        .filter((entry) => entry.changed)
        .map((entry) => entry.field);
      assert.deepEqual(changed, [field], field);
    }
=======
  canTransitionOperation, dueEscalations, operationDisplayStatus, operationEligibility,
  operationMetrics, validateOperationResponses,
} from './operations';

describe('tenant operations', () => {
  it('keeps terminal evidence terminal', () => {
    assert.equal(canTransitionOperation('completed', 'due'), false);
    assert.equal(canTransitionOperation('overdue', 'completed'), true);
  });

  it('derives time status without overwriting a claim before the deadline', () => {
    const item = { id: 'o', status: 'upcoming' as const,
      scheduledFor: '2026-08-28T10:00:00Z', dueAt: '2026-08-28T10:30:00Z',
      claimedBy: null, completedAt: null };
    assert.equal(operationDisplayStatus(item, new Date('2026-08-28T10:10:00Z')), 'due');
    assert.equal(operationDisplayStatus(item, new Date('2026-08-28T10:31:00Z')), 'overdue');
  });

  it('requires an allowed role and every current competency', () => {
    const result = operationEligibility({ roleIds: ['floor'], competencyKeys: ['sanitation'] }, {
      roleIds: ['floor'], competencyAwards: { sanitation: '2026-08-28T09:00:00Z' },
    }, new Date('2026-08-28T10:00:00Z'));
    assert.deepEqual(result, { eligible: false, missingRoles: [], missingCompetencies: ['sanitation'] });
  });

  it('validates the snapshotted checklist contract', () => {
    assert.deepEqual(validateOperationResponses([
      { key: 'floor', responseKind: 'pass_fail', required: true },
      { key: 'note', responseKind: 'text', required: false },
    ], { floor: true }), { valid: true, missing: [], invalid: [] });
  });

  it('deduplicates escalation rules and calculates operational metrics', () => {
    assert.deepEqual(dueEscalations('2026-08-28T10:00:00Z', [
      { id: 'staff', offsetMinutes: 0 }, { id: 'manager', offsetMinutes: 15 },
    ], new Set(['staff']), new Date('2026-08-28T10:16:00Z')).map((rule) => rule.id), ['manager']);
    assert.deepEqual(operationMetrics([{ id: 'o', status: 'completed',
      scheduledFor: '2026-08-28T10:00:00Z', dueAt: '2026-08-28T10:30:00Z',
      claimedBy: 'u', completedAt: '2026-08-28T10:20:00Z' }]),
    { total: 1, completed: 1, overdue: 0, onTimeRate: 1 });
>>>>>>> theirs
  });
});
