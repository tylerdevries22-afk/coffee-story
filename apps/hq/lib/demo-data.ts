import type { BrandRole } from '@platform/schema';

import coffeeStoryMenu from '../../customer/src/tenant/menu.json';

/**
 * The fixtures the console renders when no Supabase environment is present,
 * so `next build`, previews, and development all work with zero
 * infrastructure. The live data layer (lib/data.ts) returns these when
 * unconfigured and real rows when configured -- pages cannot tell the
 * difference, which is the point.
 */

export type KpiDay = {
  day: string;
  locationId: string;
  locationName: string;
  ordersCount: number;
  revenueCents: number;
  aovCents: number;
  inAppShare: number;
  loyaltyRedemptionRate: number;
  channelRevenueCents: ChannelRevenueCents;
};

export type ChannelRevenueCents = { app: number; web: number; kiosk: number; pos: number };

export type LocationSummary = {
  id: string;
  name: string;
  city: string;
  timezone: string;
  squareConnected: boolean;
  orderingPaused: boolean;
  hours: string;
};

/**
 * A screen on a wall, as the console shows it.
 *
 * `health` is the operator-facing question -- is this thing going to keep
 * working -- rather than a raw column. A device holding only a twelve-hour
 * token is "expiring": it works now and stops at the end of the day with
 * nobody to notice, which is the failure the durable secret exists to end.
 */
export type DeviceSummary = {
  id: string;
  locationId: string;
  locationName: string;
  role: 'kiosk' | 'pos' | 'display' | 'prep';
  label: string;
  health: 'revoked' | 'unpaired' | 'durable' | 'expiring';
  pairedAt: string | null;
  lastSeenAt: string | null;
  secretIssuedAt: string | null;
  secretLastUsedAt: string | null;
};

export type MenuItemSummary = {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  is86d: boolean;
  modifierGroups: number;
  imageUrl: string | null;
};

export type DropSummary = {
  id: string;
  title: string;
  itemName: string;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';
  ordersCount: number;
  revenueCents: number;
};

export type CampaignSummary = {
  id: string;
  name: string;
  channel: 'push' | 'sms' | 'email';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduledAt: string | null;
  audience: string;
  sent: number;
  redeemed: number;
};

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string;
  points: number;
  lifetimeCents: number;
  lastOrderAt: string;
};

export type FeeRow = {
  month: string;
  locationId: string;
  locationName: string;
  grossCents: number;
  feeCents: number;
  payments: number;
};

export type SessionInfo = {
  userId: string | null;
  email: string;
  role: BrandRole;
  brandId: string;
  brandName: string;
};

export const DEMO_SESSION: SessionInfo = {
  userId: null,
  email: 'owner@coffee-story.demo',
  role: 'platform_admin',
  brandId: '00000000-0000-4000-8000-000000000101',
  brandName: 'Coffee Story',
};

export const DEMO_LOCATIONS: LocationSummary[] = [
  { id: 'loc-downtown', name: 'Downtown', city: 'Denver, CO', timezone: 'America/Denver', squareConnected: true, orderingPaused: false, hours: 'Mon–Thu 8–23 · Fri–Sat 8–24 · Sun 8–23' },
  { id: 'loc-uptown', name: 'Uptown', city: 'Denver, CO', timezone: 'America/Denver', squareConnected: false, orderingPaused: false, hours: 'Mon–Sun 8–22' },
];

export const DEMO_DEVICES: DeviceSummary[] = [
  {
    id: 'dev-lobby-display', locationId: 'loc-downtown', locationName: 'Downtown',
    role: 'display', label: 'Pickup board', health: 'durable',
    pairedAt: '2026-08-14T15:04:00.000Z', lastSeenAt: '2026-08-22T17:41:00.000Z',
    secretIssuedAt: '2026-08-14T15:05:00.000Z', secretLastUsedAt: '2026-08-22T17:30:00.000Z',
  },
  {
    id: 'dev-lobby-kiosk', locationId: 'loc-downtown', locationName: 'Downtown',
    role: 'kiosk', label: 'Lobby kiosk 1', health: 'expiring',
    pairedAt: '2026-08-14T15:12:00.000Z', lastSeenAt: '2026-08-22T17:39:00.000Z',
    secretIssuedAt: null, secretLastUsedAt: null,
  },
  {
    id: 'dev-uptown-display', locationId: 'loc-uptown', locationName: 'Uptown',
    role: 'display', label: 'Pickup board', health: 'unpaired',
    pairedAt: null, lastSeenAt: null, secretIssuedAt: null, secretLastUsedAt: null,
  },
];

const DAYS = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'];

export const DEMO_KPIS: KpiDay[] = DAYS.flatMap((day, index) => [
  {
    day,
    locationId: 'loc-downtown',
    locationName: 'Downtown',
    ordersCount: 84 + index * 6,
    revenueCents: 92_400 + index * 7_800,
    aovCents: 1100 + index * 12,
    inAppShare: 0.58 + index * 0.01,
    loyaltyRedemptionRate: 0.22 + index * 0.005,
    channelRevenueCents: { app: 38_000 + index * 3_000, web: 11_000 + index * 1_000, kiosk: 9_000 + index * 1_000, pos: 34_400 + index * 2_800 },
  },
  {
    day,
    locationId: 'loc-uptown',
    locationName: 'Uptown',
    ordersCount: 51 + index * 4,
    revenueCents: 56_100 + index * 5_100,
    aovCents: 1080 + index * 9,
    inAppShare: 0.44 + index * 0.012,
    loyaltyRedemptionRate: 0.17 + index * 0.004,
    channelRevenueCents: { app: 16_000 + index * 1_500, web: 5_000 + index * 500, kiosk: 4_000 + index * 500, pos: 31_100 + index * 2_600 },
  },
]);

export const DEMO_MENU: MenuItemSummary[] = [
  { id: 'cortado', name: 'Cortado', category: 'Espresso', priceCents: 450, is86d: false, modifierGroups: 2, imageUrl: null },
  { id: 'oat-latte', name: 'Oat Latte', category: 'Espresso', priceCents: 550, is86d: false, modifierGroups: 3, imageUrl: null },
  { id: 'v60', name: 'V60 Single Origin', category: 'Brew Bar', priceCents: 600, is86d: false, modifierGroups: 1, imageUrl: null },
  { id: 'kouign', name: 'Kouign-Amann', category: 'Pastry', priceCents: 525, is86d: true, modifierGroups: 0, imageUrl: null },
];

export const DEMO_DROPS: DropSummary[] = [
  { id: 'drop-1', title: 'Honey Lavender Week', itemName: 'Honey Lavender Latte', startsAt: '2026-08-20T14:00:00Z', endsAt: '2026-08-27T05:00:00Z', status: 'live', ordersCount: 212, revenueCents: 142_900 },
  { id: 'drop-2', title: 'Sesame Spanish Latte', itemName: 'Spanish Latte', startsAt: '2026-08-29T14:00:00Z', endsAt: '2026-09-03T05:00:00Z', status: 'scheduled', ordersCount: 0, revenueCents: 0 },
  { id: 'drop-0', title: 'Cardamom Cold Brew', itemName: 'Cold Brew', startsAt: '2026-07-24T14:00:00Z', endsAt: '2026-07-27T05:00:00Z', status: 'ended', ordersCount: 486, revenueCents: 268_300 },
];

export const DEMO_CAMPAIGNS: CampaignSummary[] = [
  { id: 'camp-1', name: 'Honey Lavender is back', channel: 'push', status: 'sent', scheduledAt: '2026-08-20T15:00:00Z', audience: 'Everyone', sent: 1842, redeemed: 203 },
  { id: 'camp-2', name: 'We miss you — free upgrade', channel: 'sms', status: 'scheduled', scheduledAt: '2026-08-25T16:00:00Z', audience: 'Lapsed 30 days', sent: 0, redeemed: 0 },
];

export const DEMO_CUSTOMERS: CustomerSummary[] = [
  { id: 'cust-1', name: 'Maya Chen', phone: '+1 (720) 555-0182', points: 340, lifetimeCents: 48_200, lastOrderAt: '2026-08-21T16:20:00Z' },
  { id: 'cust-2', name: 'Dev Patel', phone: '+1 (303) 555-0197', points: 120, lifetimeCents: 21_700, lastOrderAt: '2026-08-22T14:05:00Z' },
  { id: 'cust-3', name: 'Rosa Ibarra', phone: '+1 (720) 555-0114', points: 45, lifetimeCents: 9_300, lastOrderAt: '2026-08-10T13:40:00Z' },
];

export const DEMO_FEES: FeeRow[] = [
  { month: '2026-08', locationId: 'loc-downtown', locationName: 'Downtown', grossCents: 2_612_400, feeCents: 71_800, payments: 2260 },
  { month: '2026-08', locationId: 'loc-uptown', locationName: 'Uptown', grossCents: 1_534_200, feeCents: 46_000, payments: 1385 },
  { month: '2026-07', locationId: 'loc-downtown', locationName: 'Downtown', grossCents: 2_401_100, feeCents: 68_100, payments: 2105 },
];


/**
 * A kiosk flow for the demo console.
 *
 * Deliberately sparse: it exercises the DERIVED path, so the preview shows what
 * a brand that has configured nothing actually gets rather than a hand-made
 * screen that flatters the feature.
 */
export const DEMO_KIOSK_FLOW: unknown = {
  attract: { invite: 'Touch anywhere to order' },
  family: 'item',
  tenders: ['card'],
};

export const DEMO_KIOSK_MENU = {
  categories: coffeeStoryMenu.categories.map((category) => ({ id: category.title, title: category.title })),
  itemSlugs: coffeeStoryMenu.items.map((item) => item.id),
  imageUrls: Object.fromEntries(
    coffeeStoryMenu.items.map((item) => [item.id, `/api/demo-media/menu/${item.id}`]),
  ),
};
