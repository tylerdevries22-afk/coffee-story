import type { AdminQuickActionSubmission } from '@/features/admin/admin-quick-actions';
import type { StaffDashboard, StaffSoapNote } from '@/types/domain';

/**
 * Demo-mode reducers for staff quick actions. The demo workspace must behave
 * like the live one: a submitted action visibly changes the dashboard, so the
 * success state the form shows afterwards is never a lie.
 */
export function applyDemoBlockTime(
  dashboard: StaffDashboard,
  submission: Extract<AdminQuickActionSubmission, { kind: 'block-time' }>,
  id: string,
): StaffDashboard {
  const startsAt = new Date(submission.startsAt);
  const endsAt = new Date(submission.endsAt);
  const blockedMinutes = Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000));
  return {
    ...dashboard,
    appointments: [...dashboard.appointments, {
      id,
      serviceName: `Blocked · ${submission.reason}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: 'confirmed',
      subtotalCents: 0,
      depositCents: 0,
      balanceCents: 0,
      clientName: 'Schedule block',
    }],
    openMinutes: Math.max(0, dashboard.openMinutes - blockedMinutes),
  };
}

export function applyDemoSoapNote(
  dashboard: StaffDashboard,
  submission: Extract<AdminQuickActionSubmission, { kind: 'soap' }>,
  id: string,
  createdAt: string,
): StaffDashboard {
  const note: StaffSoapNote = {
    id,
    customerId: submission.customerId,
    serviceName: submission.serviceName,
    treatmentDate: submission.treatmentDate,
    subjective: submission.subjective,
    objective: submission.objective,
    assessment: submission.assessment,
    plan: submission.plan,
    createdAt,
  };
  return { ...dashboard, soapNotes: [note, ...(dashboard.soapNotes ?? [])] };
}

export function soapNotesForClient(dashboard: StaffDashboard, customerId: string): StaffSoapNote[] {
  return (dashboard.soapNotes ?? []).filter((note) => note.customerId === customerId);
}
