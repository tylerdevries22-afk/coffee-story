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
    buildAdminQuickActionSubmission('quick-order', draft({
      guestName: ' Alex Rivera ',
      customerId: 'client-1',
      itemName: 'Pistachio Latte (16 oz)',
      itemSlug: 'deep-tissue',
      startsAt: '2026-08-02T20:30:00.000Z',
    })),
    {
      ok: true,
      value: {
        kind: 'quick-order',
        customerId: 'client-1',
        guestName: 'Alex Rivera',
        itemSlug: 'deep-tissue',
        itemName: 'Pistachio Latte (16 oz)',
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

test('requires a guest and some text before saving a note', () => {
  // The four-part SOAP validation went with the clinical record it guarded; a
  // guest note is one line, so there are two things left to require.
  assert.deepEqual(
    buildAdminQuickActionSubmission('guest-note', draft({
      customerId: 'client-2',
      guestName: 'Jamie Lee',
    })),
    { ok: false, error: 'Write the note.' },
  );
  assert.deepEqual(
    buildAdminQuickActionSubmission('guest-note', draft({ note: 'Oat, half-sweet.' })),
    { ok: false, error: 'Choose a guest.' },
  );
  const saved = buildAdminQuickActionSubmission('guest-note', draft({
    customerId: 'client-2',
    guestName: 'Jamie Lee',
    note: 'Oat, half-sweet.',
  }));
  assert.equal(saved.ok, true);
});
