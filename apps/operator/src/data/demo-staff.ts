import type { PortalOrder, StaffClient, StaffDashboard } from '@platform/domain';
import { isoAt, order } from './demo-helpers';

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

const staffAppointments: PortalOrder[] = [
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
  orders: staffAppointments,
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
