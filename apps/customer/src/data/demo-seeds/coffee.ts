import type { PortalMessage, RewardCatalogItem } from '@platform/domain';

import { createDemoGiftCards } from '../demo-gift-cards';
import { createDemoRewardLedger } from '../demo-reward-ledger';
import type { DemoOrderSeed, DemoSeedSet, IsoAt } from './types';

/**
 * Coffee's demo fixtures, wired into the shared seed-set shape.
 *
 * The order seeds, messages, and reward catalog below are the same content
 * `demo.ts` used to carry inline for every tenant that was not construction
 * -- unchanged, just moved so a coffee shop is the tenant that actually
 * declares `coffee-shop` rather than the one every other tenant fell into.
 */

const pastOrders: DemoOrderSeed[] = [
  { id: 'past-01', item: 'Spanish Latte (16 oz)', days: -235, hour: 10, priceCents: 700, status: 'picked_up' },
  { id: 'past-02', item: 'Pistachio Latte (16 oz)', days: -210, hour: 14, priceCents: 700, status: 'picked_up' },
  { id: 'past-03', item: 'Turkish Coffee (Double)', days: -182, hour: 11, priceCents: 700, status: 'picked_up' },
  { id: 'past-04', item: 'Spanish Latte (12 oz)', days: -160, hour: 9, priceCents: 600, status: 'picked_up' },
  { id: 'past-05', item: 'Sunset Sparkling Ade (20 oz)', days: -135, hour: 16, priceCents: 600, status: 'picked_up' },
  { id: 'past-06', item: 'Rooh Afza Boba (20 oz)', days: -112, hour: 13, priceCents: 700, status: 'picked_up' },
  { id: 'past-07', item: 'Adeni Chai (16 oz)', days: -90, hour: 10, priceCents: 600, status: 'picked_up' },
  { id: 'past-08', item: 'Midnight Lychee Refresher (20 oz)', days: -78, hour: 21, priceCents: 700, status: 'cancelled' },
  { id: 'past-09', item: 'Spanish Latte (16 oz)', days: -74, hour: 11, priceCents: 700, status: 'picked_up' },
  { id: 'past-10', item: 'Brown Sugar Boba (20 oz)', days: -60, hour: 14, priceCents: 700, status: 'picked_up', mobile: true },
  { id: 'past-11', item: 'Pistachio Milk Cake', days: -45, hour: 20, priceCents: 700, status: 'picked_up' },
  { id: 'past-12', item: 'Mochi Donut Trio', days: -32, hour: 13, priceCents: 1000, status: 'picked_up' },
  { id: 'past-13', item: 'Spanish Latte (20 oz)', days: -21, hour: 9, priceCents: 800, status: 'picked_up' },
  { id: 'past-14', item: 'Pistachio Latte (16 oz)', days: -14, hour: 11, priceCents: 700, status: 'picked_up' },
  { id: 'past-15', item: 'Honeycomb Cheese Bread', days: -6, hour: 19, priceCents: 700, status: 'picked_up' },
];

const upcomingOrders: DemoOrderSeed[] = [
  { id: 'demo-order', item: 'Spanish Latte (16 oz)', days: 0, hour: 17, minute: 30, priceCents: 700, status: 'paid' },
  { id: 'upcoming-02', item: 'Strawberry Nutella Croissant', days: 1, hour: 12, priceCents: 600, status: 'created' },
  { id: 'upcoming-03', item: 'Adeni Chai (16 oz)', days: 2, hour: 8, minute: 30, priceCents: 600, status: 'paid', mobile: true },
];

function coffeeMessages(isoAt: IsoAt): PortalMessage[] {
  return [
    { id: 'demo-message-1', sender: 'studio', body: 'Welcome, Alex. Send us a note here if anything changes before pickup.', sentAt: isoAt(-21, 9), read: true },
    { id: 'demo-message-2', sender: 'client', body: 'Thank you! Quick question — can I add oat milk to my usual?', sentAt: isoAt(-21, 10, 15), read: true },
    { id: 'demo-message-3', sender: 'studio', body: 'Already on your profile, so just order as usual and we will make it with oat milk.', sentAt: isoAt(-21, 10, 40), read: true },
    { id: 'demo-message-4', sender: 'client', body: 'Perfect. The pistachio cold foam last week was incredible.', sentAt: isoAt(-14, 18), read: true },
    { id: 'demo-message-5', sender: 'studio', body: 'Great to hear. Mike saved the pistachio cream recipe card for your next order.', sentAt: isoAt(-14, 18, 30), read: true },
    { id: 'demo-message-6', sender: 'client', body: 'Could I get my Spanish latte half-sweet this time?', sentAt: isoAt(-3, 8), read: true },
    { id: 'demo-message-7', sender: 'studio', body: 'Noted on your order — half-sweet Spanish latte, oat milk.', sentAt: isoAt(-3, 9), read: true },
    { id: 'demo-message-8', sender: 'studio', body: 'Reminder: your Spanish Latte pickup is today at 5:30 PM. Reply here if anything changes.', sentAt: isoAt(0, 8), read: false },
  ];
}

const COFFEE_REWARD_CATALOG: RewardCatalogItem[] = [
  { id: 'demo-r1', name: '$5 drink credit', description: 'Apply toward any drink on the menu.', pointsCost: 500, active: true },
  { id: 'demo-r2', name: 'Free mochi donut', description: 'One fresh mochi donut, any flavor.', pointsCost: 800, active: true },
  { id: 'demo-r3', name: '$15 drink credit', description: 'Apply toward any drink on the menu.', pointsCost: 1500, active: true },
  { id: 'demo-r4', name: 'Free signature latte', description: 'Any signature latte, any size.', pointsCost: 2000, active: true },
];

export const COFFEE_SEEDS: DemoSeedSet = {
  orderSeeds: [...upcomingOrders, ...pastOrders],
  rewardLedger: createDemoRewardLedger,
  rewardActivities: ['add_birthday', 'complete_intake'],
  rewardCatalog: COFFEE_REWARD_CATALOG,
  giftCards: createDemoGiftCards,
  messages: coffeeMessages,
  preferenceNotes: 'Oat milk preferred, half-sweet on the signature lattes. Pistachio anything is a yes.',
  membershipName: 'Brew Club',
};
