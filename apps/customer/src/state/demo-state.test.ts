import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDemoOrder,
  addSyncedDemoOrder,
  addDemoGift,
  addDemoMessage,
  cancelDemoOrder,
  completeDemoRewardActivity,
  createInitialDemoPortal,
  dismissDemoSetupAutoPrompt,
  demoSlotFor,
  isValidIsoSlot,
  migrateDemoPortalState,
  redeemDemoReward,
  reconcileSyncedDemoOrders,
  removeDemoPaymentMethod,
  rescheduleDemoOrder,
  setDemoRole,
  setDemoMembershipStatus,
  updateDemoIntake,
  updateDemoProfile,
} from './demo-state';
import type { PortalBundle } from '@platform/domain';

const item = {
  slug: 'deep-tissue-60',
  name: 'Deep Tissue Massage',
  category: 'specialty' as const,
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
  assert.equal(migrated.demoStateVersion, 5);
  assert.equal(migrated.autoPromptDismissed, false);
  assert.equal(migrated.profile.avatarUrl, null);
  assert.equal(dismissDemoSetupAutoPrompt(migrated).autoPromptDismissed, true);
});

test('migrates v4 pickup-window endings to v5 pickup starts', () => {
  const initial = createInitialDemoPortal();
  const first = initial.orders[0];
  const second = initial.orders[1];
  assert.ok(first && second);
  const v4: PortalBundle = {
    ...initial,
    demoStateVersion: 4,
    orders: [
      { ...first, placedAt: '2026-08-04T19:30:00.000Z', scheduledFor: '2026-08-04T20:30:00.000Z' },
      { ...second, scheduledFor: null },
    ],
  };

  const migrated = migrateDemoPortalState(v4);

  assert.equal(migrated.demoStateVersion, 5);
  assert.equal(migrated.orders[0]?.scheduledFor, '2026-08-04T19:30:00.000Z');
  assert.equal(migrated.orders[1]?.scheduledFor, null);
  assert.equal(v4.orders[0]?.scheduledFor, '2026-08-04T20:30:00.000Z');
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

test('adds a demo booking with add-on totals and the selected pickup start', () => {
  const portal = addDemoOrder(createInitialDemoPortal(), {
    id: 'order-new',
    item,
    addOns: [addOn],
    placedAt: '2026-08-04T19:30:00.000Z',
    fulfillment: {
      mode: 'pickup',
      location: {
        id: 'greenwood-village',
        name: 'Greenwood Village',
        address: '5650 Greenwood Plaza Blvd, Suite 225-C',
        cityLine: 'Greenwood Village, CO 80111',
        note: 'Primary studio · easy parking',
      },
    },
  });
  const order = portal.orders[0];
  assert.equal(order.id, 'order-new');
  assert.equal(order.subtotalCents, 12500);
  assert.equal(order.scheduledFor, order.placedAt, 'scheduledFor is the selected window start');
  assert.equal(order.fulfillmentType, 'pickup');
  assert.equal(order.locationLabel, 'Greenwood Village');
  assert.match(order.locationDetail ?? '', /5650 Greenwood Plaza/);
  // Money is integer cents and the total must equal subtotal + tax.
  assert.equal(order.totalCents, order.subtotalCents + order.taxCents);
});

test('rejects a demo order without a valid ISO slot', () => {
  assert.throws(() => addDemoOrder(createInitialDemoPortal(), {
    id: 'bad',
    item,
    addOns: [],
    placedAt: '11:30 AM',
  }));
});

test('persists one shared order identity and reconciles its status only', () => {
  const initial = createInitialDemoPortal();
  const local = addDemoOrder(initial, {
    id: 'local-template', item, addOns: [], placedAt: '2026-08-04T19:30:00.000Z',
  }).orders[0];
  const synced = addSyncedDemoOrder(initial, {
    ...local, id: 'shared-1', status: 'paid', demoSyncSessionId: 'session-a',
  });
  const reconciled = reconcileSyncedDemoOrders(synced, {
    sessionId: 'session-a',
    orders: [{
      id: 'shared-1', sessionId: 'session-a', status: 'ready', scheduledFor: local.scheduledFor,
    }],
  });
  assert.equal(reconciled.orders[0].id, 'shared-1');
  assert.equal(reconciled.orders[0].demoSynced, true);
  assert.equal(reconciled.orders[0].demoSyncSessionId, 'session-a');
  assert.equal(reconciled.orders[0].status, 'ready');
  assert.equal(reconciled.orders[1], initial.orders[0]);
  assert.equal(reconcileSyncedDemoOrders(reconciled, {
    sessionId: 'session-a', orders: [],
  }), reconciled);
});

test('retires an active shared order when its broker process has restarted', () => {
  const initial = createInitialDemoPortal();
  const local = addDemoOrder(initial, {
    id: 'local-template', item, addOns: [], placedAt: '2026-08-04T19:30:00.000Z',
  }).orders[0];
  const synced = addSyncedDemoOrder(initial, {
    ...local, id: 'shared-1', status: 'ready', demoSyncSessionId: 'session-a',
  });
  const reconciled = reconcileSyncedDemoOrders(synced, {
    sessionId: 'session-b', orders: [],
  });
  assert.equal(reconciled.orders[0].status, 'cancelled');
});

test('cancels only the selected order', () => {
  const initial = createInitialDemoPortal();
  const next = cancelDemoOrder(initial, initial.orders[0].id);
  assert.equal(next.orders[0].status, 'cancelled');
});

test('reschedules only the selected order, moving pickup and not placement', () => {
  const initial = createInitialDemoPortal();
  const order = initial.orders[0];
  const nextPickup = '2026-08-18T19:30:00.000Z';
  const next = rescheduleDemoOrder(initial, order.id, nextPickup);
  assert.equal(next.orders[0].scheduledFor, nextPickup);
  // Rescheduling moves when the order is due, never when it was placed.
  assert.equal(next.orders[0].placedAt, order.placedAt);
  assert.equal(next.orders[1]?.scheduledFor, initial.orders[1]?.scheduledFor);
  const followingWeek = '2026-08-25T19:30:00.000Z';
  assert.equal(rescheduleDemoOrder(next, order.id, followingWeek).orders[0].scheduledFor, followingWeek);
});

test('redeems an affordable cash reward and adds a ledger entry', () => {
  const initial = createInitialDemoPortal();
  const reward = {
    id: 'test-reward',
    name: '$5 credit',
    description: 'Test reward independent of the active tenant catalog.',
    pointsCost: 500,
    active: true,
  };
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

test('updates preferences state', () => {
  const initial = createInitialDemoPortal();
  const preferences = { completed: true, notes: 'Shoulders', strength: 'medium' as const, updatedAt: '2026-08-01T00:00:00.000Z' };
  assert.deepEqual(updateDemoIntake(initial, preferences).preferences, preferences);
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
