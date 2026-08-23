import type { AdminQuickActionSubmission } from '@/features/admin/admin-quick-actions';
import type { GuestNote, StaffDashboard } from '@platform/domain';

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
    // A block rides in the order list so the floor can see it, priced at zero
    // so it can never move a total. Crew mode gives blocks their own row and
    // this representation goes with it.
    orders: [...dashboard.orders, {
      id,
      status: 'paid',
      summary: `Blocked · ${submission.reason}`,
      lines: [],
      fulfillmentType: 'pickup',
      placedAt: startsAt.toISOString(),
      scheduledFor: endsAt.toISOString(),
      subtotalCents: 0,
      taxCents: 0,
      tipCents: 0,
      totalCents: 0,
      note: submission.reason,
      guestLabel: 'Schedule block',
    }],
    openMinutes: Math.max(0, dashboard.openMinutes - blockedMinutes),
  };
}

export function applyDemoGuestNote(
  dashboard: StaffDashboard,
  submission: Extract<AdminQuickActionSubmission, { kind: 'guest-note' }>,
  id: string,
  createdAt: string,
): StaffDashboard {
  const note: GuestNote = {
    id,
    customerId: submission.customerId,
    note: submission.note,
    authorName: submission.guestName,
    createdAt,
  };
  return { ...dashboard, guestNotes: [note, ...(dashboard.guestNotes ?? [])] };
}

export function notesForGuest(dashboard: StaffDashboard, customerId: string): GuestNote[] {
  return (dashboard.guestNotes ?? []).filter((note) => note.customerId === customerId);
}
