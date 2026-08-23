import type { OrderStatus } from '@platform/schema';

import { taxCentsFor } from '@platform/domain';
import type {
  GiftCard,
  PortalOrder,
  PortalBundle,
  PortalMessage,
  RewardEntry,
  StaffClient,
  StaffDashboard,
} from '@platform/domain';

// Sanitized, production-scale demo dataset. All names/emails/phones are fictional
// (example.com, 555 numbers). Every date is relative to portal creation so
// "upcoming" stays upcoming no matter when the app launches.
const now = new Date();

function dayAt(daysFromNow: number, hour: number, minute = 0): Date {
  const value = new Date(now);
  value.setDate(value.getDate() + daysFromNow);
  value.setHours(hour, minute, 0, 0);
  return value;
}

function isoAt(daysFromNow: number, hour: number, minute = 0): string {
  return dayAt(daysFromNow, hour, minute).toISOString();
}

function addMinutes(startsAt: string, minutes: number): string {
  return new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString();
}

const SHOP_LABEL = 'Coffee Story · 2222 S Havana St';
const DELIVERY_LABEL = 'Delivery';
const DELIVERY_DETAIL = '123 Dayton St, Aurora, CO 80010';

type OrderSeed = {
  id: string;
  /** One line's name; the demo carries single-line orders. */
  item: string;
  days: number;
  hour: number;
  minute?: number;
  durationMin?: number;
  priceCents: number;
  status: OrderStatus;
  /** Display-safe guest name; becomes the order's guestLabel. */
  client?: string;
  mobile?: boolean;
};

/**
 * Orders are pay-at-pickup, so the demo carries no deposit and no tip.
 *
 * Tax comes from the real jurisdiction table rather than a flat guess: the
 * demo bundle feeds the same history and receipt surfaces as the live plane,
 * and a total that does not equal subtotal + tax is the kind of thing that
 * only ever surfaces in a screenshot.
 */
function order(seed: OrderSeed): PortalOrder {
  const placedAt = isoAt(seed.days, seed.hour, seed.minute);
  const taxCents = taxCentsFor(seed.priceCents);
  return {
    id: seed.id,
    status: seed.status,
    summary: seed.item,
    lines: [{ name: seed.item, quantity: 1, unitPriceCents: seed.priceCents, options: [] }],
    fulfillmentType: seed.mobile ? 'delivery' : 'pickup',
    scheduledFor: addMinutes(placedAt, seed.durationMin ?? 15),
    placedAt,
    subtotalCents: seed.priceCents,
    taxCents,
    tipCents: 0,
    totalCents: seed.priceCents + taxCents,
    note: '',
    guestLabel: seed.client,
    locationLabel: seed.mobile ? DELIVERY_LABEL : SHOP_LABEL,
    locationDetail: seed.mobile ? DELIVERY_DETAIL : undefined,
  };
}


// --- Client portal -----------------------------------------------------------

const pastOrders: PortalOrder[] = [
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

const upcomingOrders: PortalOrder[] = [
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

const giftCards: GiftCard[] = [
  {
    id: 'demo-gift',
    code: 'CS-DEMO-2026',
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
    code: 'CS-GIFT-RCVD-02',
    initialCents: 5000,
    balanceCents: 2150,
    recipientEmail: 'alex@example.com',
    recipientName: 'Alex Rivera',
    designKey: 'healing',
    deliveryAt: null,
    status: 'claimed',
    createdAt: isoAt(-95, 12),
    claimedByCurrentUser: true,
    purchasedByCurrentUser: false,
  },
  {
    id: 'gift-received-3',
    code: 'CS-GIFT-RCVD-03',
    initialCents: 2500,
    balanceCents: 300,
    recipientEmail: 'alex@example.com',
    recipientName: 'Alex Rivera',
    designKey: 'thank-you',
    deliveryAt: null,
    status: 'claimed',
    createdAt: isoAt(-150, 15),
    claimedByCurrentUser: true,
    purchasedByCurrentUser: false,
  },
  {
    id: 'gift-sent-1',
    code: 'CS-GIFT-SENT-01',
    initialCents: 2500,
    balanceCents: 2500,
    recipientEmail: 'casey.morgan@example.com',
    recipientName: 'Casey Morgan',
    designKey: 'healing',
    deliveryAt: null,
    status: 'delivered',
    createdAt: isoAt(-33, 10),
    claimedByCurrentUser: false,
    purchasedByCurrentUser: true,
  },
  {
    id: 'gift-sent-2',
    code: 'CS-GIFT-SENT-02',
    initialCents: 5000,
    balanceCents: 1400,
    recipientEmail: 'jordan.avery@example.com',
    recipientName: 'Jordan Avery',
    designKey: 'birthday',
    deliveryAt: null,
    status: 'claimed',
    createdAt: isoAt(-70, 11),
    claimedByCurrentUser: false,
    purchasedByCurrentUser: true,
  },
  {
    id: 'gift-sent-3',
    code: 'CS-GIFT-SENT-03',
    initialCents: 1500,
    balanceCents: 1500,
    recipientEmail: 'taylor.quinn@example.com',
    recipientName: 'Taylor Quinn',
    designKey: 'quiet-hour',
    deliveryAt: isoAt(7, 8),
    status: 'funded',
    createdAt: isoAt(-2, 16),
    claimedByCurrentUser: false,
    purchasedByCurrentUser: true,
  },
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
  demoStateVersion: 4,
  autoPromptDismissed: false,
  profile: {
    id: 'demo-client',
    fullName: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '(720) 555-0144',
    birthday: '1990-07-08',
    avatarUrl: null,
  },
  role: 'client',
  orders: [...upcomingOrders, ...pastOrders],
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

// --- Staff dashboard ---------------------------------------------------------

/** Days since the guest's last completed order, for the demo rollups. */
function daysAgo(days: number): string {
  return isoAt(-days, 11);
}

const staffClients: StaffClient[] = [
  { id: 'client-1', fullName: 'Alex Rivera', email: 'alex@example.com', phone: '(720) 555-0144', completedOrders: 11, tags: ['Regular', 'Spanish latte'], lifetimeSpendCents: 18400, lastOrderAt: daysAgo(6) },
  { id: 'client-2', fullName: 'Jamie Lee', email: 'jamie.lee@example.com', phone: null, completedOrders: 4, tags: ['Regular'], lifetimeSpendCents: 5900, lastOrderAt: daysAgo(21) },
  { id: 'client-3', fullName: 'Jordan Avery', email: 'jordan.avery@example.com', phone: '(303) 555-0167', completedOrders: 9, tags: ['Brew Club', 'Boba'], lifetimeSpendCents: 10850, lastOrderAt: daysAgo(9) },
  { id: 'client-4', fullName: 'Riley Chen', email: 'riley.chen@example.com', phone: '(720) 555-0181', completedOrders: 7, tags: ['Matcha'], lifetimeSpendCents: 8200, lastOrderAt: daysAgo(14) },
  { id: 'client-5', fullName: 'Casey Morgan', email: 'casey.morgan@example.com', phone: '(303) 555-0129', completedOrders: 6, tags: ['Regular', 'Cold brew'], lifetimeSpendCents: 6850, lastOrderAt: daysAgo(30) },
  { id: 'client-6', fullName: 'Taylor Quinn', email: 'taylor.quinn@example.com', phone: null, completedOrders: 3, tags: ['New'], lifetimeSpendCents: 3150, lastOrderAt: daysAgo(4) },
  { id: 'client-7', fullName: 'Morgan Blake', email: 'morgan.blake@example.com', phone: '(720) 555-0152', completedOrders: 14, tags: ['VIP', 'Brew Club'], lifetimeSpendCents: 24800, lastOrderAt: daysAgo(1) },
  { id: 'client-8', fullName: 'Sam Whitfield', email: 'sam.whitfield@example.com', phone: '(303) 555-0193', completedOrders: 2, tags: ['New', 'Turkish coffee'], lifetimeSpendCents: 2100, lastOrderAt: daysAgo(11) },
  { id: 'client-9', fullName: 'Devin Park', email: 'devin.park@example.com', phone: '(720) 555-0176', completedOrders: 8, tags: ['Matcha', 'Brew Club'], lifetimeSpendCents: 9800, lastOrderAt: daysAgo(8) },
  { id: 'client-10', fullName: 'Harper Ellis', email: 'harper.ellis@example.com', phone: '(303) 555-0118', completedOrders: 5, tags: ['Regular'], lifetimeSpendCents: 4750, lastOrderAt: daysAgo(17) },
  { id: 'client-11', fullName: 'Quinn Nakamura', email: 'quinn.nakamura@example.com', phone: '(720) 555-0135', completedOrders: 1, tags: ['New'], lifetimeSpendCents: 1200, lastOrderAt: daysAgo(3) },
  { id: 'client-12', fullName: 'Reese Talbot', email: 'reese.talbot@example.com', phone: '(303) 555-0144', completedOrders: 10, tags: ['VIP', 'Spanish latte'], lifetimeSpendCents: 14600, lastOrderAt: daysAgo(2) },
];

const staffOrders: PortalOrder[] = [
  // Today: one done, two confirmed (checkout-eligible), one pending (badge).
  order({ id: 'staff-t0-1', item: 'Spanish Latte (16 oz)', days: 0, hour: 8, priceCents: 700, status: 'picked_up', client: 'Morgan Blake' }),
  order({ id: 'staff-t0-2', item: 'Pistachio Latte (16 oz)', days: 0, hour: 13, priceCents: 700, status: 'paid', client: 'Alex Rivera' }),
  order({ id: 'staff-t0-3', item: 'Mochi Donut Trio', days: 0, hour: 15, minute: 30, priceCents: 1000, status: 'paid', client: 'Jamie Lee' }),
  order({ id: 'staff-t0-4', item: 'Sunset Sparkling Ade (20 oz)', days: 0, hour: 17, priceCents: 600, status: 'created', client: 'Reese Talbot' }),
  order({ id: 'staff-t1-1', item: 'Rooh Afza Boba (20 oz)', days: 1, hour: 10, priceCents: 700, status: 'paid', client: 'Devin Park' }),
  order({ id: 'staff-t1-2', item: 'Spanish Latte (12 oz)', days: 1, hour: 13, minute: 30, priceCents: 600, status: 'created', client: 'Harper Ellis' }),
  order({ id: 'staff-t2-1', item: 'Adeni Chai (16 oz)', days: 2, hour: 8, minute: 30, priceCents: 600, status: 'paid', client: 'Alex Rivera' }),
  order({ id: 'staff-t3-1', item: 'Turkish Coffee (Double)', days: 3, hour: 9, priceCents: 700, status: 'paid', client: 'Quinn Nakamura' }),
  order({ id: 'staff-t3-2', item: 'Brown Sugar Boba (20 oz)', days: 3, hour: 14, priceCents: 700, status: 'paid', client: 'Sam Whitfield', mobile: true }),
  order({ id: 'staff-t4-1', item: 'Saffron Milk Cake', days: 4, hour: 20, priceCents: 700, status: 'created', client: 'Casey Morgan' }),
  order({ id: 'staff-t5-1', item: 'Strawberry Nutella Croissant', days: 5, hour: 12, minute: 30, priceCents: 600, status: 'paid', client: 'Morgan Blake' }),
  order({ id: 'staff-t5-2', item: 'Spanish Latte (16 oz)', days: 5, hour: 13, priceCents: 700, status: 'paid', client: 'Taylor Quinn' }),
  order({ id: 'staff-t6-1', item: 'Midnight Lychee Refresher (20 oz)', days: 6, hour: 21, priceCents: 700, status: 'paid', client: 'Jordan Avery' }),
  order({ id: 'staff-t7-1', item: 'Pistachio Latte (20 oz)', days: 7, hour: 9, minute: 30, priceCents: 800, status: 'paid', client: 'Riley Chen' }),
  order({ id: 'staff-t8-1', item: 'Honeycomb Cheese Bread', days: 8, hour: 19, priceCents: 700, status: 'paid', client: 'Reese Talbot', mobile: true }),
  order({ id: 'staff-t9-1', item: 'Spanish Latte (16 oz)', days: 9, hour: 14, priceCents: 700, status: 'paid', client: 'Jamie Lee' }),
  order({ id: 'staff-t9-2', item: 'Sunset Sparkling Ade (16 oz)', days: 9, hour: 16, priceCents: 600, status: 'paid', client: 'Morgan Blake' }),
  order({ id: 'staff-t10-1', item: 'Adeni Chai (12 oz)', days: 10, hour: 11, priceCents: 500, status: 'paid', client: 'Alex Rivera' }),
  order({ id: 'staff-t11-1', item: 'Turkish Coffee (Single)', days: 11, hour: 13, priceCents: 500, status: 'paid', client: 'Quinn Nakamura' }),
  order({ id: 'staff-t12-1', item: 'Rooh Afza Matcha (20 oz)', days: 12, hour: 10, priceCents: 800, status: 'paid', client: 'Devin Park', mobile: true }),
  order({ id: 'staff-t13-1', item: 'Spanish Latte (16 oz)', days: 13, hour: 15, priceCents: 700, status: 'paid', client: 'Casey Morgan' }),
];

export const DEMO_STAFF: StaffDashboard = {
  projectedCents: 3850,
  openMinutes: 120,
  promptForTip: true,
  orders: staffOrders,
  clients: staffClients,
  metrics: {
    todayRevenueCents: 6400,
    orderCount: 42,
    newClientCount: 3,
    rebookRatePct: 82,
    previous: {
      todayRevenueCents: 5710,
      orderCount: 38,
      newClientCount: 2,
      rebookRatePct: 78,
    },
    revenueTrend: [
      { label: 'Mon', cents: 52000 },
      { label: 'Tue', cents: 41000 },
      { label: 'Wed', cents: 63500 },
      { label: 'Thu', cents: 38000 },
      { label: 'Fri', cents: 71000 },
      { label: 'Sat', cents: 85500 },
      { label: 'Sun', cents: 0 },
    ],
    orderSources: [
      { source: 'website', count: 18 },
      { source: 'directory', count: 6 },
      { source: 'campaign', count: 3 },
      { source: 'staff', count: 4 },
    ],
  },
  reputation: { score: 4.9, reviewCount: 75 },
  recentPayments: [
    { id: 'pay-1', guestName: 'Morgan Blake', itemName: 'Spanish Latte (16 oz)', method: 'card', amountCents: 700, paidAt: isoAt(0, 9) },
    { id: 'pay-2', guestName: 'Reese Talbot', itemName: 'Mochi Donut Trio', method: 'gift_card', amountCents: 1000, paidAt: isoAt(-1, 15) },
    { id: 'pay-3', guestName: 'Devin Park', itemName: 'Rooh Afza Boba (20 oz)', method: 'card', amountCents: 700, paidAt: isoAt(-1, 11) },
    { id: 'pay-4', guestName: 'Jamie Lee', itemName: 'Honeycomb Cheese Bread', method: 'cash', amountCents: 700, paidAt: isoAt(-2, 16) },
    { id: 'pay-5', guestName: 'Alex Rivera', itemName: 'Turkish Coffee (Double)', method: 'card', amountCents: 700, paidAt: isoAt(-3, 13) },
  ],
  guestNotes: [
    {
      id: 'note-1',
      customerId: 'client-7',
      note: 'Usual order: pistachio latte, oat milk, half-sweet. Asked for half-sweet after finding the default too rich.',
      authorName: 'Mike A.',
      createdAt: isoAt(-4, 10),
    },
    {
      id: 'note-2',
      customerId: 'client-1',
      note: 'Orders Spanish latte before noon only; decaf Americano otherwise. Training for a half marathon; cuts caffeine after 2 PM.',
      authorName: 'Mike A.',
      createdAt: isoAt(-9, 10),
    },
    {
      id: 'note-3',
      customerId: 'client-3',
      note: 'Boba with extra pearls; milk cake if fresh that day. Late-night study guest; stays until close on Fridays.',
      authorName: 'Mike A.',
      createdAt: isoAt(-16, 10),
    },
  ],
};
