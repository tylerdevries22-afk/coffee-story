import type {
  PortalOrder,
  PortalBundle,
  PortalMessage,
  RewardEntry,
} from '@platform/domain';


import { isoAt, now, order } from './demo-helpers';

import { giftCards } from './demo-gifts';

// --- Client portal -----------------------------------------------------------

const pastAppointments: PortalOrder[] = [
  order({ id: 'past-01', item: 'Spanish Latte (16 oz)', days: -235, hour: 10, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-02', item: 'Pistachio Latte (16 oz)', days: -210, hour: 14, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-03', item: 'Turkish Coffee (Double)', days: -182, hour: 11, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-04', item: 'Spanish Latte (12 oz)', days: -160, hour: 9, priceCents: 600, status: 'picked_up' }),
  order({ id: 'past-05', item: 'Sunset Sparkling Ade (20 oz)', days: -135, hour: 16, priceCents: 600, status: 'picked_up' }),
  order({ id: 'past-06', item: 'Rooh Afza Boba (20 oz)', days: -112, hour: 13, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-07', item: 'Adeni Chai (16 oz)', days: -90, hour: 10, priceCents: 600, status: 'picked_up' }),
  order({ id: 'past-08', item: 'Midnight Lychee Refresher (20 oz)', days: -78, hour: 21, priceCents: 700, status: 'cancelled' }),
  order({ id: 'past-09', item: 'Spanish Latte (16 oz)', days: -74, hour: 11, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-10', item: 'Brown Sugar Boba (20 oz)', days: -60, hour: 14, priceCents: 700, status: 'picked_up', mobile: true }),
  order({ id: 'past-11', item: 'Pistachio Milk Cake', days: -45, hour: 20, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-12', item: 'Mochi Donut Trio', days: -32, hour: 13, priceCents: 1000, status: 'picked_up' }),
  order({ id: 'past-13', item: 'Spanish Latte (20 oz)', days: -21, hour: 9, priceCents: 800, status: 'picked_up' }),
  order({ id: 'past-14', item: 'Pistachio Latte (16 oz)', days: -14, hour: 11, priceCents: 700, status: 'picked_up' }),
  order({ id: 'past-15', item: 'Honeycomb Cheese Bread', days: -6, hour: 19, priceCents: 700, status: 'picked_up' }),
];

const upcomingAppointments: PortalOrder[] = [
  order({ id: 'demo-order', item: 'Spanish Latte (16 oz)', days: 0, hour: 17, minute: 30, priceCents: 700, status: 'paid' }),
  order({ id: 'upcoming-02', item: 'Strawberry Nutella Croissant', days: 1, hour: 12, priceCents: 600, status: 'created' }),
  order({ id: 'upcoming-03', item: 'Adeni Chai (16 oz)', days: 2, hour: 8, minute: 30, priceCents: 600, status: 'paid', mobile: true }),
];

// Account totals are authoritative (the server returns them alongside a recent
// activity window); the ledger below is that recent window, not full history.
// Annual 1,876 → House Regular tier, 624 Beans from Coffee Legend. Available
// 1,376 after the $5-credit redemption → $5 credit + free mochi donut unlocked,
// $15 credit + free signature latte locked.
const rewardLedger: RewardEntry[] = [
  { id: 'ledger-01', entryType: 'purchase', points: 91, description: 'Honeycomb Cheese Bread', earnedAt: isoAt(-6, 19), expiresAt: isoAt(359, 19) },
  { id: 'ledger-02', entryType: 'purchase', points: 84, description: 'Pistachio Latte (16 oz)', earnedAt: isoAt(-14, 11), expiresAt: isoAt(351, 11) },
  { id: 'ledger-03', entryType: 'activity', points: 10, description: 'set your usual order', earnedAt: isoAt(-20, 9), expiresAt: isoAt(345, 9) },
  { id: 'ledger-04', entryType: 'purchase', points: 96, description: 'Spanish Latte (20 oz)', earnedAt: isoAt(-21, 9), expiresAt: isoAt(344, 9) },
  { id: 'ledger-05', entryType: 'redemption', points: -500, description: 'Redeemed $5 drink credit', earnedAt: isoAt(-24, 12), expiresAt: null },
  { id: 'ledger-06', entryType: 'purchase', points: 120, description: 'Mochi Donut Trio', earnedAt: isoAt(-32, 13), expiresAt: isoAt(333, 13) },
  { id: 'ledger-07', entryType: 'activity', points: 5, description: 'add birthday', earnedAt: isoAt(-38, 8), expiresAt: isoAt(327, 8) },
  { id: 'ledger-08', entryType: 'purchase', points: 84, description: 'Pistachio Milk Cake', earnedAt: isoAt(-45, 20), expiresAt: isoAt(320, 20) },
  { id: 'ledger-09', entryType: 'purchase', points: 84, description: 'Brown Sugar Boba (20 oz)', earnedAt: isoAt(-60, 14), expiresAt: isoAt(305, 14) },
  { id: 'ledger-10', entryType: 'purchase', points: 84, description: 'Spanish Latte (16 oz)', earnedAt: isoAt(-74, 11), expiresAt: isoAt(291, 11) },
  { id: 'ledger-11', entryType: 'purchase', points: 72, description: 'Adeni Chai (16 oz)', earnedAt: isoAt(-90, 10), expiresAt: isoAt(275, 10) },
  { id: 'ledger-12', entryType: 'purchase', points: 84, description: 'Rooh Afza Boba (20 oz)', earnedAt: isoAt(-112, 13), expiresAt: isoAt(253, 13) },
  { id: 'ledger-13', entryType: 'expiration', points: -40, description: 'Expired Beans', earnedAt: isoAt(-120, 0), expiresAt: null },
  { id: 'ledger-14', entryType: 'purchase', points: 72, description: 'Sunset Sparkling Ade (20 oz)', earnedAt: isoAt(-135, 16), expiresAt: isoAt(230, 16) },
  { id: 'ledger-15', entryType: 'purchase', points: 72, description: 'Spanish Latte (12 oz)', earnedAt: isoAt(-160, 9), expiresAt: isoAt(205, 9) },
  { id: 'ledger-16', entryType: 'purchase', points: 84, description: 'Turkish Coffee (Double)', earnedAt: isoAt(-182, 11), expiresAt: isoAt(183, 11) },
  { id: 'ledger-17', entryType: 'purchase', points: 84, description: 'Pistachio Latte (16 oz)', earnedAt: isoAt(-210, 14), expiresAt: isoAt(155, 14) },
  { id: 'ledger-18', entryType: 'purchase', points: 70, description: 'Spanish Latte (16 oz)', earnedAt: isoAt(-400, 10), expiresAt: isoAt(-35, 10) },
];

const messages: PortalMessage[] = [
  { id: 'demo-message-1', sender: 'studio', body: 'Welcome, Alex. Send us a note here if anything changes before pickup.', sentAt: isoAt(-21, 9), read: true },
  { id: 'demo-message-2', sender: 'client', body: 'Thank you! Quick question — can I add oat milk to my usual?', sentAt: isoAt(-21, 10, 15), read: true },
  { id: 'demo-message-3', sender: 'studio', body: 'Already on your profile, so just order as usual and we will make it with oat milk.', sentAt: isoAt(-21, 10, 40), read: true },
  { id: 'demo-message-4', sender: 'client', body: 'Perfect. The pistachio cold foam last week was incredible.', sentAt: isoAt(-14, 18), read: true },
  { id: 'demo-message-5', sender: 'studio', body: 'Great to hear. Mike saved the pistachio cream recipe card for your next order.', sentAt: isoAt(-14, 18, 30), read: true },
  { id: 'demo-message-6', sender: 'client', body: 'Could I get my Spanish latte half-sweet this time?', sentAt: isoAt(-3, 8), read: true },
  { id: 'demo-message-7', sender: 'studio', body: 'Noted on your order — half-sweet Spanish latte, oat milk.', sentAt: isoAt(-3, 9), read: true },
  { id: 'demo-message-8', sender: 'studio', body: 'Reminder: your Spanish Latte pickup is today at 5:30 PM. Reply here if anything changes.', sentAt: isoAt(0, 8), read: false },
];

export const DEMO_PORTAL: PortalBundle = {
  demoStateVersion: 5,
  autoPromptDismissed: false,
  profile: {
    id: 'demo-client',
    fullName: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '(720) 555-0144',
    birthday: '1990-07-08',
    avatarUrl: null,
  },
  // The operator app's demo opens on the shift floor, not in the guest shell.
  role: 'staff',
  orders: [...upcomingAppointments, ...pastAppointments],
  rewardAccount: {
    availablePoints: 1376,
    annualPoints: 1876,
    cashCents: 2500,
    annualPeriodStart: `${now.getFullYear()}-01-01`,
  },
  rewardLedger: rewardLedger,
  rewardActivities: ['add_birthday', 'complete_intake'],
  rewardCatalog: [
    { id: 'demo-r1', name: '$5 drink credit', description: 'Apply toward any drink on the menu.', pointsCost: 500, active: true },
    { id: 'demo-r2', name: 'Free mochi donut', description: 'One fresh mochi donut, any flavor.', pointsCost: 800, active: true },
    { id: 'demo-r3', name: '$15 drink credit', description: 'Apply toward any drink on the menu.', pointsCost: 1500, active: true },
    { id: 'demo-r4', name: 'Free signature latte', description: 'Any signature latte, any size.', pointsCost: 2000, active: true },
  ],
  giftCards,
  paymentMethods: [
    { id: 'demo-payment-1', brand: 'Visa', last4: '4242', expirationMonth: 12, expirationYear: now.getFullYear() + 2, isDefault: true },
    { id: 'demo-payment-2', brand: 'Mastercard', last4: '5544', expirationMonth: 8, expirationYear: now.getFullYear() + 1, isDefault: false },
  ],
  messages,
  preferences: {
    completed: true,
    notes: 'Oat milk preferred, half-sweet on the signature lattes. Pistachio anything is a yes.',
    strength: 'medium',
        updatedAt: isoAt(-20, 9),
  },
  membership: {
    id: 'demo-membership',
    name: 'Brew Club',
    status: 'active',
    priceCents: 1900,
    renewsAt: new Date(now.getFullYear(), now.getMonth() + 1, 5).toISOString(),
    creditsAvailable: 4,
  },
};

export { DEMO_STAFF } from './demo-staff';
