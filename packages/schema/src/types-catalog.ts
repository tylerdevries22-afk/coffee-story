import type { DropStatus, ItemRotation, Json } from './types-core';

export type MenuRow = {
  id: string;
  brand_id: string;
  name: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type MenuCategoryRow = {
  id: string;
  brand_id: string;
  menu_id: string;
  title: string;
  tagline: string;
  sort_order: number;
  created_at: string;
};

export type MenuItemRow = {
  id: string;
  brand_id: string;
  menu_id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string;
  image_url: string | null;
  base_price_cents: number;
  sizes: Json;
  modifiers: Json;
  availability: Json;
  is_86d: boolean;
  is_listed: boolean;
  sort_order: number;
  rotation: ItemRotation;
  /** ISO weekday, 1 = Monday. Non-null exactly when rotation is day_specific. */
  weekday: number | null;
  /** Null means this is not a pack. */
  pack_size: number | null;
  choice_source: 'lineup' | 'static' | null;
  single_item_id: string | null;
  /** Stable slugs authored for this pack; availability narrows this set. */
  pack_choice_slugs: string[];
  created_at: string;
  updated_at: string;
};

export type DropRow = {
  id: string;
  brand_id: string;
  item_id: string;
  /** Visible as a teaser from here; null = no separate reveal. */
  reveal_at: string | null;
  starts_at: string;
  ends_at: string;
  status: DropStatus;
  hero_asset_url: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerRow = {
  id: string;
  brand_id: string;
  user_id: string | null;
  phone: string | null;
  full_name: string;
  email: string | null;
  push_token: string | null;
  sms_opt_in: boolean;
  created_at: string;
  updated_at: string;
};

export type LoyaltyAccountRow = {
  id: string;
  brand_id: string;
  customer_id: string;
  points_balance: number;
  lifetime_points: number;
  created_at: string;
  updated_at: string;
};

export type LoyaltyEventRow = {
  id: string;
  brand_id: string;
  account_id: string;
  order_id: string | null;
  type: 'earn' | 'redeem' | 'adjust' | 'reverse';
  points: number;
  note: string;
  created_at: string;
};

export type StoredValueLedgerRow = {
  id: string;
  brand_id: string;
  customer_id: string;
  order_id: string | null;
  type: 'load' | 'spend' | 'refund' | 'adjust' | 'gift_received';
  amount_cents: number;
  balance_after_cents: number;
  note: string;
  created_at: string;
};

export type ReferralRow = {
  id: string;
  brand_id: string;
  referrer_customer_id: string;
  code: string;
  referred_customer_id: string | null;
  status: 'issued' | 'claimed' | 'rewarded' | 'expired';
  created_at: string;
  claimed_at: string | null;
};
