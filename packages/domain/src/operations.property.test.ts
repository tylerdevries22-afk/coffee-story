import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  diffOperationTemplates,
  dueEscalations,
  operationEligibility,
  operationMetrics,
  operationRunsOnIsoWeekday,
  validateOperationRecurrence,
  validateOperationResponses,
  type ChecklistStep,
  type OperationOccurrence,
  type OperationTemplateSnapshot,
  type WorkerEligibility,
} from './operations';

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [[...values]];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]));
}

function occurrence(id: string, status: OperationOccurrence['status']): OperationOccurrence {
  return {
    id,
    status,
    scheduledFor: '2026-08-28T10:00:00.000Z',
    dueAt: '2026-08-28T10:30:00.000Z',
    claimedBy: null,
    completedAt: status === 'completed' ? '2026-08-28T10:20:00.000Z' : null,
  };
}

const TEMPLATE: OperationTemplateSnapshot = {
  templateId: 'template',
  templateKey: 'round',
  programKey: 'rounds',
  routineKind: 'interval',
  revision: 1,
  title: 'Round',
  instructions: 'Instructions',
  estimatedMinutes: 10,
  requiredRoleIds: ['floor'],
  requiredCompetencyKeys: ['safety'],
  issueCategories: ['repair'],
  steps: [{ key: 'check', responseKind: 'confirm', required: true }],
};

test('weekly recurrence membership and validation are invariant under weekday permutations', () => {
  for (const weekdays of permutations([1, 3, 7])) {
    const recurrence = { frequency: 'weekly' as const, weekdays };
    assert.deepEqual(validateOperationRecurrence(recurrence), []);
    for (let day = 1; day <= 7; day += 1) {
      assert.equal(operationRunsOnIsoWeekday(recurrence, day), [1, 3, 7].includes(day));
    }
  }
});

test('checklist validity is invariant under step permutations', () => {
  const steps: readonly ChecklistStep[] = [
    { key: 'confirm', responseKind: 'confirm', required: true },
    { key: 'pass', responseKind: 'pass_fail', required: true, issueOnFailure: true },
    { key: 'count', responseKind: 'number', required: true, minimum: 0, maximum: 2 },
    { key: 'note', responseKind: 'text', required: false, maxLength: 10 },
  ];
  const responses = { confirm: true, pass: false, count: 1, note: 'ok' };

  for (const reordered of permutations(steps)) {
    const result = validateOperationResponses(reordered, responses, new Set(['pass']));
    assert.equal(result.valid, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, []);
    assert.deepEqual(result.unknown, []);
    assert.deepEqual(result.unresolvedFailures, []);
  }
});

test('adding a qualifying role or award never turns an eligible worker ineligible', () => {
  const requirement = { roleIds: ['floor', 'lead'], competencyKeys: ['safety', 'equipment'] };
  const now = new Date('2026-08-28T10:00:00.000Z');
  const eligible = operationEligibility(requirement, {
    roleIds: ['floor'],
    competencyAwards: { safety: null, equipment: '2026-08-29T10:00:00.000Z' },
  }, now);
  assert.equal(eligible.eligible, true);

  const additions: readonly WorkerEligibility[] = [
    { roleIds: ['floor', 'lead'], competencyAwards: { safety: null, equipment: '2026-08-29T10:00:00.000Z' } },
    { roleIds: ['floor'], competencyAwards: { safety: null, equipment: null, extra: null } },
  ];
  for (const worker of additions) {
    assert.equal(operationEligibility(requirement, worker, now).eligible, true);
  }
});

test('escalation selection is invariant under input permutations and monotonic over time', () => {
  const rules = [
    { id: 'staff', offsetMinutes: 0, order: 1 },
    { id: 'manager', offsetMinutes: 15, order: 2 },
    { id: 'owner', offsetMinutes: 60, order: 3 },
  ];
  const expectedByTime = [
    ['2026-08-28T10:29:59.999Z', []],
    ['2026-08-28T10:30:00.000Z', ['staff']],
    ['2026-08-28T10:45:00.000Z', ['staff', 'manager']],
    ['2026-08-28T11:30:00.000Z', ['staff', 'manager', 'owner']],
  ] as const;

  for (const reordered of permutations(rules)) {
    for (const [timestamp, expected] of expectedByTime) {
      const actual = dueEscalations(
        '2026-08-28T10:30:00.000Z',
        reordered,
        new Set(),
        new Date(timestamp),
      ).map((rule) => rule.id);
      assert.deepEqual(actual, [...expected]);
    }
  }
});

test('metrics are permutation-invariant and rates remain bounded', () => {
  const rows = [
    occurrence('completed', 'completed'),
    occurrence('missed', 'missed'),
    occurrence('cancelled', 'cancelled'),
    occurrence('future', 'scheduled'),
  ];
  const expected = operationMetrics(rows);

  for (const reordered of permutations(rows)) {
    const metrics = operationMetrics(reordered);
    assert.deepEqual(metrics, expected);
    for (const rate of [metrics.completionRate, metrics.onTimeRate, metrics.overdueRate]) {
      assert.ok(rate !== null && rate >= 0 && rate <= 1);
    }
    assert.equal((metrics.onTimeRate ?? 0) + (metrics.overdueRate ?? 0), 1);
  }
});

test('template diff is symmetric for the set of changed fields and does not mutate inputs', () => {
  const local: OperationTemplateSnapshot = {
    ...TEMPLATE,
    title: 'Local round',
    requiredRoleIds: ['lead'],
    steps: [{ key: 'local-check', responseKind: 'confirm', required: true }],
  };
  const brandBefore = JSON.stringify(TEMPLATE);
  const localBefore = JSON.stringify(local);
  const forward = diffOperationTemplates(TEMPLATE, local).filter((entry) => entry.changed)
    .map((entry) => entry.field).sort();
  const reverse = diffOperationTemplates(local, TEMPLATE).filter((entry) => entry.changed)
    .map((entry) => entry.field).sort();

  assert.deepEqual(forward, ['requiredRoleIds', 'steps', 'title']);
  assert.deepEqual(reverse, forward);
  assert.equal(JSON.stringify(TEMPLATE), brandBefore);
  assert.equal(JSON.stringify(local), localBefore);
});
