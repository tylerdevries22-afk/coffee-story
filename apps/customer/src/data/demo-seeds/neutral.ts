import type { GiftCard, PortalMessage, RewardCatalogItem, RewardEntry } from '@platform/domain';

import type { DemoOrderSeed, DemoSeedSet, IsoAt } from './types';

/**
 * The neutral demo fixtures, for a tenant that names no industry -- or names
 * one the platform has not written a pack for yet.
 *
 * A tenant lands here by declaring `business.industryKey: "generic"`, the
 * same rule the home screen's `GENERIC` pack (`home-industry-copy.ts`)
 * follows for its marketing copy. Nothing here names a product, a venue, or
 * a fulfillment model. The platform's own domain noun is "order" (see
 * `GENERIC_COPY` in `packages/ui/src/copy-industry.ts`), so that is the word
 * this file leans on too.
 */

const pastOrders: DemoOrderSeed[] = [
  { id: 'past-01', item: 'Standard Package', days: -235, hour: 10, priceCents: 700, status: 'picked_up' },
  { id: 'past-02', item: 'Priority Service', days: -210, hour: 14, priceCents: 700, status: 'picked_up' },
  { id: 'past-03', item: 'Extended Package', days: -182, hour: 11, priceCents: 700, status: 'picked_up' },
  { id: 'past-04', item: 'Standard Package', days: -160, hour: 9, priceCents: 600, status: 'picked_up' },
  { id: 'past-05', item: 'Add-on Item', days: -135, hour: 16, priceCents: 600, status: 'picked_up' },
  { id: 'past-06', item: 'Bundle Renewal', days: -112, hour: 13, priceCents: 700, status: 'picked_up' },
  { id: 'past-07', item: 'Follow-up Order', days: -90, hour: 10, priceCents: 600, status: 'picked_up' },
  { id: 'past-08', item: 'Evening Order', days: -78, hour: 21, priceCents: 700, status: 'cancelled' },
  { id: 'past-09', item: 'Standard Package', days: -74, hour: 11, priceCents: 700, status: 'picked_up' },
  { id: 'past-10', item: 'Scheduled Renewal', days: -60, hour: 14, priceCents: 700, status: 'picked_up', mobile: true },
  { id: 'past-11', item: 'Add-on Item', days: -45, hour: 20, priceCents: 700, status: 'picked_up' },
  { id: 'past-12', item: 'Bundle Package', days: -32, hour: 13, priceCents: 1000, status: 'picked_up' },
  { id: 'past-13', item: 'Priority Service', days: -21, hour: 9, priceCents: 800, status: 'picked_up' },
  { id: 'past-14', item: 'Standard Package', days: -14, hour: 11, priceCents: 700, status: 'picked_up' },
  { id: 'past-15', item: 'Wrap-up Order', days: -6, hour: 19, priceCents: 700, status: 'picked_up' },
];

const upcomingOrders: DemoOrderSeed[] = [
  { id: 'demo-order', item: 'Standard Package', days: 0, hour: 17, minute: 30, priceCents: 700, status: 'paid' },
  { id: 'upcoming-02', item: 'Follow-up Order', days: 1, hour: 12, priceCents: 600, status: 'created' },
  { id: 'upcoming-03', item: 'Priority Service', days: 2, hour: 8, minute: 30, priceCents: 600, status: 'paid', mobile: true },
];

function neutralMessages(isoAt: IsoAt): PortalMessage[] {
  return [
    { id: 'demo-message-1', sender: 'studio', body: 'Welcome, Alex. Send us a note here if anything changes before your order is ready.', sentAt: isoAt(-21, 9), read: true },
    { id: 'demo-message-2', sender: 'client', body: 'Thank you! Quick question — can I add a note to my usual order?', sentAt: isoAt(-21, 10, 15), read: true },
    { id: 'demo-message-3', sender: 'studio', body: 'Already on your profile, so just place your order as usual and we will take care of it.', sentAt: isoAt(-21, 10, 40), read: true },
    { id: 'demo-message-4', sender: 'client', body: 'Perfect. My last order turned out great.', sentAt: isoAt(-14, 18), read: true },
    { id: 'demo-message-5', sender: 'studio', body: 'Great to hear. We saved your preferences for next time.', sentAt: isoAt(-14, 18, 30), read: true },
    { id: 'demo-message-6', sender: 'client', body: 'Could I adjust the timing on this order?', sentAt: isoAt(-3, 8), read: true },
    { id: 'demo-message-7', sender: 'studio', body: 'Noted — your order has been updated.', sentAt: isoAt(-3, 9), read: true },
    { id: 'demo-message-8', sender: 'studio', body: 'Reminder: your order is ready today at 5:30 PM. Reply here if anything changes.', sentAt: isoAt(0, 8), read: false },
  ];
}

const NEUTRAL_REWARD_CATALOG: RewardCatalogItem[] = [
  { id: 'demo-r1', name: '$5 account credit', description: 'Apply toward any order.', pointsCost: 500, active: true },
  { id: 'demo-r2', name: 'Free add-on', description: 'One add-on item, your choice.', pointsCost: 800, active: true },
  { id: 'demo-r3', name: '$15 account credit', description: 'Apply toward any order.', pointsCost: 1500, active: true },
  { id: 'demo-r4', name: 'Free priority service', description: 'Any priority service, once.', pointsCost: 2000, active: true },
];

function createNeutralRewardLedger(isoAt: IsoAt): RewardEntry[] {
  return [
    { id: 'ledger-01', entryType: 'purchase', points: 91, description: 'Wrap-up Order', earnedAt: isoAt(-6, 19), expiresAt: isoAt(359, 19) },
    { id: 'ledger-02', entryType: 'purchase', points: 84, description: 'Standard Package', earnedAt: isoAt(-14, 11), expiresAt: isoAt(351, 11) },
    { id: 'ledger-03', entryType: 'activity', points: 10, description: 'set your usual order', earnedAt: isoAt(-20, 9), expiresAt: isoAt(345, 9) },
    { id: 'ledger-04', entryType: 'purchase', points: 96, description: 'Priority Service', earnedAt: isoAt(-21, 9), expiresAt: isoAt(344, 9) },
    { id: 'ledger-05', entryType: 'redemption', points: -500, description: 'Redeemed $5 account credit', earnedAt: isoAt(-24, 12), expiresAt: null },
    { id: 'ledger-06', entryType: 'purchase', points: 120, description: 'Bundle Package', earnedAt: isoAt(-32, 13), expiresAt: isoAt(333, 13) },
    { id: 'ledger-07', entryType: 'activity', points: 5, description: 'add birthday', earnedAt: isoAt(-38, 8), expiresAt: isoAt(327, 8) },
    { id: 'ledger-08', entryType: 'purchase', points: 84, description: 'Add-on Item', earnedAt: isoAt(-45, 20), expiresAt: isoAt(320, 20) },
    { id: 'ledger-09', entryType: 'purchase', points: 84, description: 'Scheduled Renewal', earnedAt: isoAt(-60, 14), expiresAt: isoAt(305, 14) },
    { id: 'ledger-10', entryType: 'purchase', points: 84, description: 'Standard Package', earnedAt: isoAt(-74, 11), expiresAt: isoAt(291, 11) },
    { id: 'ledger-11', entryType: 'purchase', points: 72, description: 'Follow-up Order', earnedAt: isoAt(-90, 10), expiresAt: isoAt(275, 10) },
    { id: 'ledger-12', entryType: 'expiration', points: -40, description: 'Expired account credit', earnedAt: isoAt(-120, 0), expiresAt: null },
  ];
}

function createNeutralGiftCards(isoAt: IsoAt): GiftCard[] {
  return [
    {
      id: 'demo-gift',
      code: 'DEMO-GIFT-2026',
      initialCents: 2500,
      balanceCents: 2500,
      recipientEmail: 'alex@example.com',
      recipientName: 'Alex',
      designKey: 'quiet-hour',
      deliveryAt: null,
      status: 'claimed',
      createdAt: isoAt(-46, 9),
      claimedByCurrentUser: true,
      purchasedByCurrentUser: false,
    },
    {
      id: 'gift-received-2',
      code: 'DEMO-GIFT-RCVD-02',
      initialCents: 5000,
      balanceCents: 2150,
      recipientEmail: 'alex@example.com',
      recipientName: 'Alex Rivera',
      designKey: 'thank-you',
      deliveryAt: null,
      status: 'claimed',
      createdAt: isoAt(-95, 12),
      claimedByCurrentUser: true,
      purchasedByCurrentUser: false,
    },
    {
      id: 'gift-sent-1',
      code: 'DEMO-GIFT-SENT-01',
      initialCents: 2500,
      balanceCents: 2500,
      recipientEmail: 'casey.morgan@example.com',
      recipientName: 'Casey Morgan',
      designKey: 'well-done',
      deliveryAt: null,
      status: 'delivered',
      createdAt: isoAt(-33, 10),
      claimedByCurrentUser: false,
      purchasedByCurrentUser: true,
    },
    {
      id: 'gift-sent-2',
      code: 'DEMO-GIFT-SENT-02',
      initialCents: 1500,
      balanceCents: 1500,
      recipientEmail: 'taylor.quinn@example.com',
      recipientName: 'Taylor Quinn',
      designKey: 'birthday',
      deliveryAt: isoAt(7, 8),
      status: 'funded',
      createdAt: isoAt(-2, 16),
      claimedByCurrentUser: false,
      purchasedByCurrentUser: true,
    },
  ];
}

export const NEUTRAL_SEEDS: DemoSeedSet = {
  orderSeeds: [...upcomingOrders, ...pastOrders],
  rewardLedger: createNeutralRewardLedger,
  rewardActivities: ['add_birthday', 'complete_intake'],
  rewardCatalog: NEUTRAL_REWARD_CATALOG,
  giftCards: createNeutralGiftCards,
  messages: neutralMessages,
  preferenceNotes: 'Prefers email updates and a text reminder before each order is ready.',
  membershipName: 'Member Circle',
};
