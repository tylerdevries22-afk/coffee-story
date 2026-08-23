export type AdminQuickActionKey = 'order' | 'quick-order' | 'block-time' | 'guest-note';

export type AdminQuickActionDraft = {
  customerId: string;
  guestName: string;
  itemSlug: string;
  itemName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  notes: string;
  /** The whole of a guest note. Replaces a four-part clinical SOAP record. */
  note: string;
};

export type AdminQuickActionSubmission =
  | { kind: 'order'; customerId: string; guestName: string; itemSlug: string; itemName: string; startsAt: string; notes: string }
  | { kind: 'quick-order'; customerId: string; guestName: string; itemSlug: string; itemName: string; startsAt: string; notes: string }
  | { kind: 'block-time'; startsAt: string; endsAt: string; reason: string }
  | { kind: 'guest-note'; customerId: string; guestName: string; note: string };

export type AdminQuickActionHandlers = Partial<{
  book: (submission: Extract<AdminQuickActionSubmission, { kind: 'order' }>) => Promise<void>;
  'quick-order': (submission: Extract<AdminQuickActionSubmission, { kind: 'quick-order' }>) => Promise<void>;
  'block-time': (submission: Extract<AdminQuickActionSubmission, { kind: 'block-time' }>) => Promise<void>;
  'guest-note': (submission: Extract<AdminQuickActionSubmission, { kind: 'guest-note' }>) => Promise<void>;
}>;

export const EMPTY_ADMIN_QUICK_ACTION_DRAFT: AdminQuickActionDraft = {
  customerId: '',
  guestName: '',
  itemSlug: '',
  itemName: '',
  startsAt: '',
  endsAt: '',
  reason: '',
  notes: '',
  note: '',
};

export function buildAdminQuickActionSubmission(
  action: AdminQuickActionKey,
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  if (action === 'block-time') return buildBlockTimeSubmission(draft);
  if (action === 'guest-note') return buildGuestNoteSubmission(draft);
  return buildOrderSubmission(action, draft);
}

function buildOrderSubmission(
  kind: 'order' | 'quick-order',
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  if (!draft.customerId.trim() || !draft.guestName.trim()) return { ok: false, error: 'Choose a client.' };
  if (!draft.itemSlug.trim() || !draft.itemName.trim()) return { ok: false, error: 'Choose a service.' };
  const startsAt = new Date(draft.startsAt);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: 'Enter a valid ISO order time.' };
  return {
    ok: true,
    value: {
      kind,
      customerId: draft.customerId.trim(),
      guestName: draft.guestName.trim(),
      itemSlug: draft.itemSlug.trim(),
      itemName: draft.itemName.trim(),
      startsAt: startsAt.toISOString(),
      notes: draft.notes.trim(),
    },
  };
}

function buildBlockTimeSubmission(
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  const startsAt = new Date(draft.startsAt);
  const endsAt = new Date(draft.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: 'Enter valid ISO start and end times.' };
  }
  if (endsAt <= startsAt) return { ok: false, error: 'End time must be after start time.' };
  if (!draft.reason.trim()) return { ok: false, error: 'Add a reason for the schedule block.' };
  return {
    ok: true,
    value: { kind: 'block-time', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: draft.reason.trim() },
  };
}

function buildGuestNoteSubmission(
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  if (!draft.customerId.trim() || !draft.guestName.trim()) return { ok: false, error: 'Choose a guest.' };
  if (!draft.note.trim()) return { ok: false, error: 'Write the note.' };
  return {
    ok: true,
    value: {
      kind: 'guest-note',
      customerId: draft.customerId.trim(),
      guestName: draft.guestName.trim(),
      note: draft.note.trim(),
    },
  };
}
