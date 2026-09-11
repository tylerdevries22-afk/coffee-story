import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

import type { AdminQuickActionHandlers, AdminQuickActionSubmission } from '@/features/admin/admin-quick-actions';
import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import { applyDemoBlockTime, applyDemoGuestNote } from '@/features/staff/dashboard';
import { mobileApi } from '@/lib/mobile-api';
import { requestKey, taxCentsFor, type OrderableItem, type PickupLocation,
  type StaffDashboard } from '@platform/domain';

export function useStaffQuickActions({ isDemo, loadDashboard, orderableItems,
  pickupLocations, setDashboard }: {
  isDemo: boolean; loadDashboard: () => Promise<void>; orderableItems: OrderableItem[];
  pickupLocations: readonly PickupLocation[]; setDashboard: Dispatch<SetStateAction<StaffDashboard>>;
}): AdminQuickActionHandlers {
  const createStaffOrder = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'order' | 'quick-order' }>,
  ) => {
    if (isDemo) {
      const item = orderableItems.find((entry) => entry.slug === submission.itemSlug);
      const placedAt = new Date(submission.startsAt);
      const priceCents = item?.priceCents ?? 0;
      const taxCents = taxCentsFor(priceCents, DEMO_OPERATOR_FIXTURES.taxJurisdictions);
      setDashboard((current) => ({ ...current, orders: [...current.orders, {
        id: requestKey('demo-order'), status: 'paid', summary: submission.itemName,
        lines: [{ name: submission.itemName, quantity: 1, unitPriceCents: priceCents, options: [] }],
        fulfillmentType: 'pickup', placedAt: placedAt.toISOString(),
        scheduledFor: new Date(placedAt.getTime() + (item?.durationMin ?? 5) * 60_000).toISOString(),
        subtotalCents: priceCents, taxCents, tipCents: 0, totalCents: priceCents + taxCents,
        note: submission.notes, guestLabel: submission.guestName,
      }], projectedCents: current.projectedCents + priceCents }));
      return;
    }
    const [pickupLocation] = pickupLocations;
    if (!pickupLocation) throw new Error('This shop has no location with a posted address yet. Add one in HQ first.');
    await mobileApi.staffAction({ action: 'create_order', customerId: submission.customerId,
      itemSlug: submission.itemSlug, scheduledFor: submission.startsAt,
      fulfillment: { mode: 'pickup', location: pickupLocation }, notes: submission.notes,
      idempotencyKey: requestKey('staff-order') });
    await loadDashboard();
  }, [isDemo, loadDashboard, orderableItems, pickupLocations, setDashboard]);
  const blockStaffTime = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'block-time' }>,
  ) => {
    if (isDemo) { setDashboard((current) => applyDemoBlockTime(current, submission, requestKey('demo-block'))); return; }
    await mobileApi.staffAction({ action: 'block_time', startsAt: submission.startsAt,
      endsAt: submission.endsAt, reason: submission.reason, idempotencyKey: requestKey('staff-block') });
    await loadDashboard();
  }, [isDemo, loadDashboard, setDashboard]);
  const createGuestNote = useCallback(async (
    submission: Extract<AdminQuickActionSubmission, { kind: 'guest-note' }>,
  ) => {
    if (isDemo) {
      setDashboard((current) => applyDemoGuestNote(current, submission,
        requestKey('demo-note'), new Date().toISOString()));
      return;
    }
    await loadDashboard();
  }, [isDemo, loadDashboard, setDashboard]);
  return useMemo(() => ({ order: createStaffOrder, 'quick-order': createStaffOrder,
    'block-time': blockStaffTime, 'guest-note': createGuestNote }),
  [blockStaffTime, createStaffOrder, createGuestNote]);
}
