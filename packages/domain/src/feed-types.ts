/**
 * What a notification points at when tapped, and what its trailing action does.
 * Kept as a small union rather than free-form callbacks so the feed stays pure
 * and testable; the screen maps each target onto real navigation.
 */
export type NotificationTarget =
  | { kind: 'orders' }
  | { kind: 'rewards' }
  | { kind: 'gift-balance' }
  | { kind: 'staff-calendar' }
  | { kind: 'staff-checkout' }
  | { kind: 'confirm-order'; orderId: string };

export type NotificationItem = {
  id: string;
  /** Who or what the row leads with; drives the avatar monogram. */
  actor: string;
  /** Bold lead-in, then the rest of the sentence. Instagram reads the same way. */
  title: string;
  detail: string;
  /** ISO timestamp the row is grouped and sorted by. */
  at: string;
  target: NotificationTarget;
  /** Trailing button label, when the row offers an action beyond navigating. */
  action?: string;
};

export type NotificationSection = {
  /** 'New' | 'Today' | 'This week' | 'This month' | 'Earlier' */
  title: string;
  items: NotificationItem[];
};
