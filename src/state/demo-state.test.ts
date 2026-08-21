import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDemoBooking,
  addDemoGift,
  addDemoMessage,
  cancelDemoAppointment,
  completeDemoRewardActivity,
  createInitialDemoPortal,
  dismissDemoSetupAutoPrompt,
  demoSlotFor,
  isValidIsoSlot,
  migrateDemoPortalState,
  redeemDemoReward,
  removeDemoPaymentMethod,
  rescheduleDemoAppointment,
  setDemoRole,
  setDemoMembershipStatus,
  updateDemoIntake,
  updateDemoProfile,
} from './demo-state';
import type { PortalBundle } from '@/types/domain';

const service = {
  slug: 'deep-tissue-60',
  name: 'Deep Tissue Massage',
  category: 'therapeutic' as const,
  durationMin: 60,
  priceCents: 11000,
  depositCents: 2500,
};
const addOn = {
  slug: 'aromatherapy',
  name: 'Aromatherapy',
  priceCents: 1500,
  durationMin: 5,
  description: 'Calming oils',
};

test('creates a detached initial demo portal', () => {
  const first = createInitialDemoPortal();
  const second = createInitialDemoPortal();
  first.profile.fullName = 'Changed';
  assert.notEqual(second.profile.fullName, first.profile.fullName);
});

test('migrates old demo state and persists one global setup dismissal', () => {
  const initial = createInitialDemoPortal();
  const oldPortal = { ...initial, demoStateVersion: undefined, autoPromptDismissed: undefined };
  const migrated = migrateDemoPortalState(oldPortal);
  assert.equal(migrated.demoStateVersion, 4);
  assert.equal(migrated.autoPromptDismissed, false);
  assert.equal(migrated.profile.avatarUrl, null);
  assert.equal(dismissDemoSetupAutoPrompt(migrated).autoPromptDismissed, true);
});

test('migrates an invalid persisted avatar back to the initials fallback', () => {
  const initial = createInitialDemoPortal();
  const corrupted = {
    ...initial,
    profile: { ...initial.profile, avatarUrl: { hostile: true } },
  } as unknown as PortalBundle;
  assert.equal(migrateDemoPortalState(corrupted).profile.avatarUrl, null);
});

test('changes the preview role without mutating portal data', () => {
  const initial = createInitialDemoPortal();
  const staff = setDemoRole(initial, 'staff');
  const admin = setDemoRole(staff, 'admin');
  assert.equal(initial.role, 'client');
  assert.equal(staff.role, 'staff');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.profile.fullName, initial.profile.fullName);
  assert.notEqual(admin, initial);
});

test('validates ISO slots and converts demo labels into ISO values', () => {
  const slot = demoSlotFor('2026-08-04', '1:30 PM');
  assert.ok(slot);
  assert.equal(isValidIsoSlot(slot), true);
  assert.equal(isValidIsoSlot('1:30 PM'), false);
  assert.equal(demoSlotFor('bad-date', '1:30 PM'), null);
});

test('adds a demo booking with add-on totals and duration', () => {
  const portal = addDemoBooking(createInitialDemoPortal(), {
    id: 'appointment-new',
    service,
    addOns: [addOn],
    startsAt: '2026-08-04T19:30:00.000Z',
    fulfillment: {
      mode: 'office',
      office: {
        id: 'greenwood-village',
        name: 'Greenwood Village',
        address: '5650 Greenwood Plaza Blvd, Suite 225-C',
        cityLine: 'Greenwood Village, CO 80111',
        note: 'Primary studio · easy parking',
      },
    },
  });
  const appointment = portal.appointments[0];
  assert.equal(appointment.id, 'appointment-new');
  assert.equal(appointment.subtotalCents, 12500);
  assert.equal(new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime(), 65 * 60_000);
  assert.equal(appointment.fulfillmentMode, 'office');
  assert.equal(appointment.locationLabel, 'Greenwood Village');
  assert.match(appointment.locationDetail ?? '', /5650 Greenwood Plaza/);
});

test('rejects a demo booking without a valid ISO slot', () => {
  assert.throws(() => addDemoBooking(createInitialDemoPortal(), {
    id: 'bad',
    service,
    addOns: [],
    startsAt: '11:30 AM',
  }));
});

test('cancels only the selected appointment', () => {
  const initial = createInitialDemoPortal();
  const next = cancelDemoAppointment(initial, initial.appointments[0].id);
  assert.equal(next.appointments[0].status, 'cancelled');
});

test('reschedules only the selected appointment and preserves duration', () => {
  const initial = createInitialDemoPortal();
  const appointment = initial.appointments[0];
  const originalDuration = new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime();
  const nextStart = '2026-08-18T19:30:00.000Z';
  const next = rescheduleDemoAppointment(initial, appointment.id, nextStart);
  assert.equal(next.appointments[0].startsAt, nextStart);
  assert.equal(new Date(next.appointments[0].endsAt).getTime() - new Date(nextStart).getTime(), originalDuration);
});

test('redeems an affordable cash reward and adds a ledger entry', () => {
  const initial = createInitialDemoPortal();
  const reward = initial.rewardCatalog[0];
  const next = redeemDemoReward(initial, reward, 'ledger-new', '2026-08-01T00:00:00.000Z');
  assert.equal(next.rewardAccount.availablePoints, initial.rewardAccount.availablePoints - reward.pointsCost);
  assert.equal(next.rewardAccount.cashCents, initial.rewardAccount.cashCents + 500);
  assert.equal(next.rewardLedger[0].id, 'ledger-new');
});

test('completes an eligible demo activity only once', () => {
  const initial = createInitialDemoPortal();
  const next = completeDemoRewardActivity(initial, 'refer_friend', 'activity-new', '2026-08-01T00:00:00.000Z');
  const repeated = completeDemoRewardActivity(next, 'refer_friend', 'activity-repeat', '2026-08-01T00:00:00.000Z');
  assert.equal(next.rewardAccount.availablePoints, initial.rewardAccount.availablePoints + 20);
  assert.equal(repeated, next);
});

test('adds a purchased gift card', () => {
  const initial = createInitialDemoPortal();
  const gift = { ...initial.giftCards[0], id: 'gift-new', code: 'FH-NEW' };
  const next = addDemoGift(initial, gift);
  assert.equal(next.giftCards[0].code, 'FH-NEW');
});

test('normalizes profile name and email', () => {
  const initial = createInitialDemoPortal();
  const next = updateDemoProfile(initial, { ...initial.profile, fullName: '  Alex Rivera  ', email: ' alex@example.com ' });
  assert.equal(next.profile.fullName, 'Alex Rivera');
  assert.equal(next.profile.email, 'alex@example.com');
});

test('updates intake state', () => {
  const initial = createInitialDemoPortal();
  const intake = { completed: true, concerns: 'Shoulders', pressurePreference: 'medium' as const, consentAccepted: true, updatedAt: '2026-08-01T00:00:00.000Z' };
  assert.deepEqual(updateDemoIntake(initial, intake).intake, intake);
});

test('adds a message after existing conversation', () => {
  const initial = createInitialDemoPortal();
  const message = { id: 'message-new', sender: 'client' as const, body: 'Hello', sentAt: '2026-08-01T00:00:00.000Z', read: true };
  const next = addDemoMessage(initial, message);
  assert.equal(next.messages?.at(-1)?.id, 'message-new');
});

test('removes a payment method and promotes the first remaining method', () => {
  const initial = createInitialDemoPortal();
  const extra = { id: 'second', brand: 'Mastercard', last4: '4444', expirationMonth: 1, expirationYear: 2030, isDefault: false };
  const next = removeDemoPaymentMethod({ ...initial, paymentMethods: [...(initial.paymentMethods ?? []), extra] }, 'demo-payment-1');
  // Seed ships two cards; removing the default promotes the seed's second card.
  assert.equal(next.paymentMethods?.[0].id, 'demo-payment-2');
  assert.equal(next.paymentMethods?.[0].isDefault, true);
  assert.equal(next.paymentMethods?.some((method) => method.id === 'demo-payment-1'), false);
});

test('changes membership status without mutating the original portal', () => {
  const initial = createInitialDemoPortal();
  const next = setDemoMembershipStatus(initial, 'paused');
  assert.equal(next.membership?.status, 'paused');
  assert.equal(initial.membership?.status, 'active');
});
