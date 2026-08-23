import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminQuickActionSubmission,
  EMPTY_ADMIN_QUICK_ACTION_DRAFT,
  type AdminQuickActionDraft,
} from './admin-quick-actions';

function draft(overrides: Partial<AdminQuickActionDraft>): AdminQuickActionDraft {
  return { ...EMPTY_ADMIN_QUICK_ACTION_DRAFT, ...overrides };
}

test('builds a validated quick booking submission', () => {
  assert.deepEqual(
    buildAdminQuickActionSubmission('quick-book', draft({
      clientName: ' Alex Rivera ',
      customerId: 'client-1',
      serviceName: 'Pistachio Latte (16 oz)',
      serviceSlug: 'deep-tissue',
      startsAt: '2026-08-02T20:30:00.000Z',
    })),
    {
      ok: true,
      value: {
        kind: 'quick-book',
        customerId: 'client-1',
        clientName: 'Alex Rivera',
        serviceSlug: 'deep-tissue',
        serviceName: 'Pistachio Latte (16 oz)',
        startsAt: '2026-08-02T20:30:00.000Z',
        notes: '',
      },
    },
  );
});

test('rejects an invalid schedule block and normalizes a valid one', () => {
  assert.deepEqual(
    buildAdminQuickActionSubmission('block-time', draft({
      startsAt: '2026-08-02T15:00:00.000Z',
      endsAt: '2026-08-02T14:00:00.000Z',
      reason: 'Studio reset',
    })),
    { ok: false, error: 'End time must be after start time.' },
  );
  const result = buildAdminQuickActionSubmission('block-time', draft({
    startsAt: '2026-08-02T14:00:00.000Z',
    endsAt: '2026-08-02T15:00:00.000Z',
    reason: ' Studio reset ',
  }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.kind, 'block-time');
});
