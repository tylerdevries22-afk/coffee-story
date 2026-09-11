import type { BrandRole } from '@platform/schema';

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
