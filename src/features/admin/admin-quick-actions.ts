export type AdminQuickActionKey = 'book' | 'quick-book' | 'block-time' | 'soap';

export type AdminQuickActionDraft = {
  customerId: string;
  clientName: string;
  serviceSlug: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  treatmentDate: string;
  notes: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

export type AdminQuickActionSubmission =
  | { kind: 'book'; customerId: string; clientName: string; serviceSlug: string; serviceName: string; startsAt: string; notes: string }
  | { kind: 'quick-book'; customerId: string; clientName: string; serviceSlug: string; serviceName: string; startsAt: string; notes: string }
  | { kind: 'block-time'; startsAt: string; endsAt: string; reason: string }
  | { kind: 'soap'; customerId: string; clientName: string; serviceName: string; treatmentDate: string; subjective: string; objective: string; assessment: string; plan: string };

export type AdminQuickActionHandlers = Partial<{
  book: (submission: Extract<AdminQuickActionSubmission, { kind: 'book' }>) => Promise<void>;
  'quick-book': (submission: Extract<AdminQuickActionSubmission, { kind: 'quick-book' }>) => Promise<void>;
  'block-time': (submission: Extract<AdminQuickActionSubmission, { kind: 'block-time' }>) => Promise<void>;
  soap: (submission: Extract<AdminQuickActionSubmission, { kind: 'soap' }>) => Promise<void>;
}>;

export const EMPTY_ADMIN_QUICK_ACTION_DRAFT: AdminQuickActionDraft = {
  customerId: '',
  clientName: '',
  serviceSlug: '',
  serviceName: '',
  startsAt: '',
  endsAt: '',
  reason: '',
  treatmentDate: '',
  notes: '',
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
};

export function buildAdminQuickActionSubmission(
  action: AdminQuickActionKey,
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  if (action === 'block-time') return buildBlockTimeSubmission(draft);
  if (action === 'soap') return buildSoapSubmission(draft);
  return buildBookingSubmission(action, draft);
}

function buildBookingSubmission(
  kind: 'book' | 'quick-book',
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  if (!draft.customerId.trim() || !draft.clientName.trim()) return { ok: false, error: 'Choose a client.' };
  if (!draft.serviceSlug.trim() || !draft.serviceName.trim()) return { ok: false, error: 'Choose a service.' };
  const startsAt = new Date(draft.startsAt);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: 'Enter a valid ISO appointment time.' };
  return {
    ok: true,
    value: {
      kind,
      customerId: draft.customerId.trim(),
      clientName: draft.clientName.trim(),
      serviceSlug: draft.serviceSlug.trim(),
      serviceName: draft.serviceName.trim(),
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

function buildSoapSubmission(
  draft: AdminQuickActionDraft,
): { ok: true; value: AdminQuickActionSubmission } | { ok: false; error: string } {
  if (!draft.customerId.trim() || !draft.clientName.trim()) return { ok: false, error: 'Choose a client.' };
  if (!draft.serviceName.trim()) return { ok: false, error: 'Enter the service name.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.treatmentDate)) return { ok: false, error: 'Enter the treatment date as YYYY-MM-DD.' };
  if (![draft.subjective, draft.objective, draft.assessment, draft.plan].every((value) => value.trim())) {
    return { ok: false, error: 'Complete all four SOAP sections.' };
  }
  return {
    ok: true,
    value: {
      kind: 'soap',
      customerId: draft.customerId.trim(),
      clientName: draft.clientName.trim(),
      serviceName: draft.serviceName.trim(),
      treatmentDate: draft.treatmentDate,
      subjective: draft.subjective.trim(),
      objective: draft.objective.trim(),
      assessment: draft.assessment.trim(),
      plan: draft.plan.trim(),
    },
  };
}
