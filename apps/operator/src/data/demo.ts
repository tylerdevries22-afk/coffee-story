import type {
  GiftCard,
  PortalAppointment,
  PortalBundle,
  PortalMessage,
  RewardEntry,
  StaffClient,
  StaffDashboard,
} from '@/types/domain';

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

type AppointmentSeed = {
  id: string;
  service: string;
  days: number;
  hour: number;
  minute?: number;
  durationMin?: number;
  priceCents: number;
  status: PortalAppointment['status'];
  client?: string;
  mobile?: boolean;
  source?: PortalAppointment['bookingSource'];
  recoveryMin?: number;
  newClient?: boolean;
  staff?: string;
};

// Orders are pay-at-pickup: no deposit, the full balance is due at the counter.
function appointment(seed: AppointmentSeed): PortalAppointment {
  const startsAt = isoAt(seed.days, seed.hour, seed.minute);
  const done = seed.status === 'completed' || seed.status === 'cancelled' || seed.status === 'no_show';
  return {
    id: seed.id,
    serviceName: seed.service,
    startsAt,
    endsAt: addMinutes(startsAt, seed.durationMin ?? 15),
    status: seed.status,
    subtotalCents: seed.priceCents,
    depositCents: 0,
    balanceCents: done ? 0 : seed.priceCents,
    clientName: seed.client,
    fulfillmentMode: seed.mobile ? 'dispatch' : 'office',
    locationLabel: seed.mobile ? DELIVERY_LABEL : SHOP_LABEL,
    locationDetail: seed.mobile ? DELIVERY_DETAIL : undefined,
    bookingSource: seed.source,
    recoveryMinutes: seed.recoveryMin ?? 0,
    isNewClient: seed.newClient ?? false,
    staffName: seed.staff ?? PRIMARY_BARISTA,
  };
}

const PRIMARY_BARISTA = 'Mike A.';

// --- Client portal -----------------------------------------------------------

const pastAppointments: PortalAppointment[] = [
  appointment({ id: 'past-01', service: 'Spanish Latte (16 oz)', days: -235, hour: 10, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-02', service: 'Pistachio Latte (16 oz)', days: -210, hour: 14, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-03', service: 'Turkish Coffee (Double)', days: -182, hour: 11, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-04', service: 'Spanish Latte (12 oz)', days: -160, hour: 9, priceCents: 600, status: 'completed' }),
  appointment({ id: 'past-05', service: 'Sunset Sparkling Ade (20 oz)', days: -135, hour: 16, priceCents: 600, status: 'completed' }),
  appointment({ id: 'past-06', service: 'Rooh Afza Boba (20 oz)', days: -112, hour: 13, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-07', service: 'Adeni Chai (16 oz)', days: -90, hour: 10, priceCents: 600, status: 'completed' }),
  appointment({ id: 'past-08', service: 'Midnight Lychee Refresher (20 oz)', days: -78, hour: 21, priceCents: 700, status: 'cancelled' }),
  appointment({ id: 'past-09', service: 'Spanish Latte (16 oz)', days: -74, hour: 11, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-10', service: 'Brown Sugar Boba (20 oz)', days: -60, hour: 14, priceCents: 700, status: 'completed', mobile: true }),
  appointment({ id: 'past-11', service: 'Pistachio Milk Cake', days: -45, hour: 20, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-12', service: 'Mochi Donut Trio', days: -32, hour: 13, priceCents: 1000, status: 'completed' }),
  appointment({ id: 'past-13', service: 'Spanish Latte (20 oz)', days: -21, hour: 9, priceCents: 800, status: 'completed' }),
  appointment({ id: 'past-14', service: 'Pistachio Latte (16 oz)', days: -14, hour: 11, priceCents: 700, status: 'completed' }),
  appointment({ id: 'past-15', service: 'Honeycomb Cheese Bread', days: -6, hour: 19, priceCents: 700, status: 'completed' }),
];

const upcomingAppointments: PortalAppointment[] = [
  appointment({ id: 'demo-appointment', service: 'Spanish Latte (16 oz)', days: 0, hour: 17, minute: 30, priceCents: 700, status: 'confirmed' }),
  appointment({ id: 'upcoming-02', service: 'Strawberry Nutella Croissant', days: 1, hour: 12, priceCents: 600, status: 'pending' }),
  appointment({ id: 'upcoming-03', service: 'Adeni Chai (16 oz)', days: 2, hour: 8, minute: 30, priceCents: 600, status: 'confirmed', mobile: true }),
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
  { id: 'demo-message-5', sender: 'studio', body: 'Great to hear. Mike saved the pistachio cream recipe card for your next visit.', sentAt: isoAt(-14, 18, 30), read: true },
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
  // The operator app's demo opens on the shift floor, not in the guest shell.
  role: 'staff',
  appointments: [...upcomingAppointments, ...pastAppointments],
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
  intake: {
    completed: true,
    concerns: 'Oat milk preferred, half-sweet on the signature lattes. Pistachio anything is a yes.',
    pressurePreference: 'medium',
    consentAccepted: true,
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

/** Days since the guest's last completed visit, for the demo rollups. */
function daysAgo(days: number): string {
  return isoAt(-days, 11);
}

const staffClients: StaffClient[] = [
  { id: 'client-1', fullName: 'Alex Rivera', email: 'alex@example.com', phone: '(720) 555-0144', completedVisits: 11, tags: ['Regular', 'Spanish latte'], lifetimeSpendCents: 18400, lastVisitAt: daysAgo(6) },
  { id: 'client-2', fullName: 'Jamie Lee', email: 'jamie.lee@example.com', phone: null, completedVisits: 4, tags: ['Regular'], lifetimeSpendCents: 5900, lastVisitAt: daysAgo(21) },
  { id: 'client-3', fullName: 'Jordan Avery', email: 'jordan.avery@example.com', phone: '(303) 555-0167', completedVisits: 9, tags: ['Brew Club', 'Boba'], lifetimeSpendCents: 10850, lastVisitAt: daysAgo(9) },
  { id: 'client-4', fullName: 'Riley Chen', email: 'riley.chen@example.com', phone: '(720) 555-0181', completedVisits: 7, tags: ['Matcha'], lifetimeSpendCents: 8200, lastVisitAt: daysAgo(14) },
  { id: 'client-5', fullName: 'Casey Morgan', email: 'casey.morgan@example.com', phone: '(303) 555-0129', completedVisits: 6, tags: ['Regular', 'Cold brew'], lifetimeSpendCents: 6850, lastVisitAt: daysAgo(30) },
  { id: 'client-6', fullName: 'Taylor Quinn', email: 'taylor.quinn@example.com', phone: null, completedVisits: 3, tags: ['New'], lifetimeSpendCents: 3150, lastVisitAt: daysAgo(4) },
  { id: 'client-7', fullName: 'Morgan Blake', email: 'morgan.blake@example.com', phone: '(720) 555-0152', completedVisits: 14, tags: ['VIP', 'Brew Club'], lifetimeSpendCents: 24800, lastVisitAt: daysAgo(1) },
  { id: 'client-8', fullName: 'Sam Whitfield', email: 'sam.whitfield@example.com', phone: '(303) 555-0193', completedVisits: 2, tags: ['New', 'Turkish coffee'], lifetimeSpendCents: 2100, lastVisitAt: daysAgo(11) },
  { id: 'client-9', fullName: 'Devin Park', email: 'devin.park@example.com', phone: '(720) 555-0176', completedVisits: 8, tags: ['Matcha', 'Brew Club'], lifetimeSpendCents: 9800, lastVisitAt: daysAgo(8) },
  { id: 'client-10', fullName: 'Harper Ellis', email: 'harper.ellis@example.com', phone: '(303) 555-0118', completedVisits: 5, tags: ['Regular'], lifetimeSpendCents: 4750, lastVisitAt: daysAgo(17) },
  { id: 'client-11', fullName: 'Quinn Nakamura', email: 'quinn.nakamura@example.com', phone: '(720) 555-0135', completedVisits: 1, tags: ['New'], lifetimeSpendCents: 1200, lastVisitAt: daysAgo(3) },
  { id: 'client-12', fullName: 'Reese Talbot', email: 'reese.talbot@example.com', phone: '(303) 555-0144', completedVisits: 10, tags: ['VIP', 'Spanish latte'], lifetimeSpendCents: 14600, lastVisitAt: daysAgo(2) },
];

const staffAppointments: PortalAppointment[] = [
  // Today: one done, two confirmed (checkout-eligible), one pending (badge).
  appointment({ id: 'staff-t0-1', service: 'Spanish Latte (16 oz)', days: 0, hour: 8, priceCents: 700, status: 'completed', client: 'Morgan Blake' }),
  appointment({ id: 'staff-t0-2', service: 'Pistachio Latte (16 oz)', days: 0, hour: 13, priceCents: 700, status: 'confirmed', client: 'Alex Rivera', source: 'website', recoveryMin: 5 }),
  appointment({ id: 'staff-t0-3', service: 'Mochi Donut Trio', days: 0, hour: 15, minute: 30, priceCents: 1000, status: 'confirmed', client: 'Jamie Lee', source: 'directory' }),
  appointment({ id: 'staff-t0-4', service: 'Sunset Sparkling Ade (20 oz)', days: 0, hour: 17, priceCents: 600, status: 'pending', client: 'Reese Talbot', source: 'campaign', newClient: true }),
  appointment({ id: 'staff-t1-1', service: 'Rooh Afza Boba (20 oz)', days: 1, hour: 10, priceCents: 700, status: 'confirmed', client: 'Devin Park', source: 'website', recoveryMin: 5 }),
  appointment({ id: 'staff-t1-2', service: 'Spanish Latte (12 oz)', days: 1, hour: 13, minute: 30, priceCents: 600, status: 'pending', client: 'Harper Ellis', source: 'directory' }),
  appointment({ id: 'staff-t2-1', service: 'Adeni Chai (16 oz)', days: 2, hour: 8, minute: 30, priceCents: 600, status: 'confirmed', client: 'Alex Rivera', source: 'website' }),
  appointment({ id: 'staff-t3-1', service: 'Turkish Coffee (Double)', days: 3, hour: 9, priceCents: 700, status: 'confirmed', client: 'Quinn Nakamura' }),
  appointment({ id: 'staff-t3-2', service: 'Brown Sugar Boba (20 oz)', days: 3, hour: 14, priceCents: 700, status: 'confirmed', client: 'Sam Whitfield', mobile: true }),
  appointment({ id: 'staff-t4-1', service: 'Saffron Milk Cake', days: 4, hour: 20, priceCents: 700, status: 'pending', client: 'Casey Morgan' }),
  appointment({ id: 'staff-t5-1', service: 'Strawberry Nutella Croissant', days: 5, hour: 12, minute: 30, priceCents: 600, status: 'confirmed', client: 'Morgan Blake' }),
  appointment({ id: 'staff-t5-2', service: 'Spanish Latte (16 oz)', days: 5, hour: 13, priceCents: 700, status: 'confirmed', client: 'Taylor Quinn' }),
  appointment({ id: 'staff-t6-1', service: 'Midnight Lychee Refresher (20 oz)', days: 6, hour: 21, priceCents: 700, status: 'confirmed', client: 'Jordan Avery' }),
  appointment({ id: 'staff-t7-1', service: 'Pistachio Latte (20 oz)', days: 7, hour: 9, minute: 30, priceCents: 800, status: 'confirmed', client: 'Riley Chen' }),
  appointment({ id: 'staff-t8-1', service: 'Honeycomb Cheese Bread', days: 8, hour: 19, priceCents: 700, status: 'confirmed', client: 'Reese Talbot', mobile: true }),
  appointment({ id: 'staff-t9-1', service: 'Spanish Latte (16 oz)', days: 9, hour: 14, priceCents: 700, status: 'confirmed', client: 'Jamie Lee' }),
  appointment({ id: 'staff-t9-2', service: 'Sunset Sparkling Ade (16 oz)', days: 9, hour: 16, priceCents: 600, status: 'confirmed', client: 'Morgan Blake' }),
  appointment({ id: 'staff-t10-1', service: 'Adeni Chai (12 oz)', days: 10, hour: 11, priceCents: 500, status: 'confirmed', client: 'Alex Rivera' }),
  appointment({ id: 'staff-t11-1', service: 'Turkish Coffee (Single)', days: 11, hour: 13, priceCents: 500, status: 'confirmed', client: 'Quinn Nakamura' }),
  appointment({ id: 'staff-t12-1', service: 'Rooh Afza Matcha (20 oz)', days: 12, hour: 10, priceCents: 800, status: 'confirmed', client: 'Devin Park', mobile: true }),
  appointment({ id: 'staff-t13-1', service: 'Spanish Latte (16 oz)', days: 13, hour: 15, priceCents: 700, status: 'confirmed', client: 'Casey Morgan' }),
];

export const DEMO_STAFF: StaffDashboard = {
  projectedCents: 3850,
  openMinutes: 120,
  promptForTip: true,
  appointments: staffAppointments,
  clients: staffClients,
  metrics: {
    todayRevenueCents: 6400,
    appointmentCount: 42,
    newClientCount: 3,
    rebookRatePct: 82,
    previous: {
      todayRevenueCents: 5710,
      appointmentCount: 38,
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
    bookingSources: [
      { source: 'website', count: 18 },
      { source: 'directory', count: 6 },
      { source: 'campaign', count: 3 },
      { source: 'staff', count: 4 },
    ],
  },
  reputation: { score: 4.9, reviewCount: 75 },
  recentPayments: [
    { id: 'pay-1', clientName: 'Morgan Blake', itemName: 'Spanish Latte (16 oz)', method: 'card', amountCents: 700, paidAt: isoAt(0, 9) },
    { id: 'pay-2', clientName: 'Reese Talbot', itemName: 'Mochi Donut Trio', method: 'gift_card', amountCents: 1000, paidAt: isoAt(-1, 15) },
    { id: 'pay-3', clientName: 'Devin Park', itemName: 'Rooh Afza Boba (20 oz)', method: 'card', amountCents: 700, paidAt: isoAt(-1, 11) },
    { id: 'pay-4', clientName: 'Jamie Lee', itemName: 'Honeycomb Cheese Bread', method: 'cash', amountCents: 700, paidAt: isoAt(-2, 16) },
    { id: 'pay-5', clientName: 'Alex Rivera', itemName: 'Turkish Coffee (Double)', method: 'card', amountCents: 700, paidAt: isoAt(-3, 13) },
  ],
};
