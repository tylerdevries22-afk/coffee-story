import type { PortalBundle, StaffDashboard } from './domain';

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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Instagram's grouping: anything unread-fresh leads under "New", then the rest
 * fall into widening time buckets. Empty buckets are dropped so the page never
 * shows a header with nothing under it.
 */
export function groupNotifications(
  items: readonly NotificationItem[],
  now: Date,
  unreadIds: ReadonlySet<string> = new Set(),
): NotificationSection[] {
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
  // Named rather than indexed. Indexing a literal array is safe and the
  // compiler cannot see it, so every push needed a `!` or a `?.` that said
  // nothing about the code -- naming the buckets removes the question.
  const unread: NotificationSection = { title: 'New', items: [] };
  const today: NotificationSection = { title: 'Today', items: [] };
  const week: NotificationSection = { title: 'This week', items: [] };
  const month: NotificationSection = { title: 'This month', items: [] };
  const earlier: NotificationSection = { title: 'Earlier', items: [] };
  const buckets = [unread, today, week, month, earlier];

  for (const item of sorted) {
    const age = now.getTime() - new Date(item.at).getTime();
    if (unreadIds.has(item.id)) {
      unread.items.push(item);
      continue;
    }
    if (age < DAY) today.items.push(item);
    else if (age < 7 * DAY) week.items.push(item);
    else if (age < 30 * DAY) month.items.push(item);
    else earlier.items.push(item);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}

/** Instagram-style compact age: 5m, 3h, 2d, 4w, then a date. */
export function relativeAge(at: string, now: Date): string {
  const age = now.getTime() - new Date(at).getTime();
  if (age < HOUR) return `${Math.max(1, Math.round(age / MINUTE))}m`;
  if (age < DAY) return `${Math.round(age / HOUR)}h`;
  if (age < 7 * DAY) return `${Math.round(age / DAY)}d`;
  if (age < 30 * DAY) return `${Math.round(age / (7 * DAY))}w`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(at));
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Who the shop is, in the two places this feed speaks as it.
 *
 * `actor` drives the row's lead-in and its avatar monogram, so it has to be
 * the guest's own shop -- and `pointsName` is whatever that shop calls its
 * points, which is already a copy key every tenant sets. Both had been typed
 * in as "Coffee Story" and "Beans", which is one shop's name and one shop's
 * word for points, inside the package every tenant compiles against.
 *
 * Passed in rather than read: packages/domain stays framework-free, so it has
 * no theme to ask.
 */
export type FeedVoice = {
  brandName: string;
  pointsName: string;
};

/**
 * Deliberately plain rather than a placeholder like "{brand}". A caller that
 * forgets to pass a voice should render a sentence that is merely generic, not
 * one that shows the guest an unresolved template.
 */
const DEFAULT_VOICE: FeedVoice = { brandName: 'The shop', pointsName: 'Points' };

/**
 * The client's feed, assembled from data the app already holds: upcoming and
 * just-finished orders, reward movement, and gift cards received.
 */
export function buildClientNotifications(
  portal: PortalBundle,
  now: Date,
  voice: Partial<FeedVoice> = {},
): NotificationItem[] {
  const { brandName, pointsName } = { ...DEFAULT_VOICE, ...voice };
  const items: NotificationItem[] = [];

  for (const order of portal.orders) {
    // An order's moment is when it is due at the counter, not when it was
    // placed; an asap order falls back to its placed time.
    const dueAt = new Date(order.scheduledFor ?? order.placedAt);
    const ahead = dueAt.getTime() - now.getTime();
    if (order.status === 'paid' && ahead > 0 && ahead < 3 * DAY) {
      items.push({
        id: `order-soon-${order.id}`,
        actor: brandName,
        title: 'Your order is coming up',
        detail: `${order.summary} · ${formatWhen(order.scheduledFor ?? order.placedAt)}`,
        at: new Date(dueAt.getTime() - 2 * DAY).toISOString(),
        target: { kind: 'orders' },
        action: 'View',
      });
    }
    if (order.status === 'picked_up' && now.getTime() - dueAt.getTime() < 30 * DAY) {
      items.push({
        id: `order-done-${order.id}`,
        actor: brandName,
        title: 'Thanks for stopping by',
        detail: `${order.summary} · ${formatWhen(order.placedAt)}`,
        at: order.scheduledFor ?? order.placedAt,
        target: { kind: 'orders' },
        action: 'Order again',
      });
    }
  }

  for (const entry of portal.rewardLedger) {
    // Redemptions and expirations already surface on the rewards screen; the
    // feed only celebrates points arriving.
    if (entry.points <= 0) continue;
    items.push({
      id: `reward-${entry.id}`,
      actor: pointsName,
      title: `You earned ${entry.points} points`,
      detail: entry.description,
      at: entry.earnedAt,
      target: { kind: 'rewards' },
      action: 'View',
    });
  }

  for (const card of portal.giftCards) {
    // A card this member claimed but did not buy is one somebody sent them.
    if (!card.claimedByCurrentUser || card.purchasedByCurrentUser) continue;
    if (card.balanceCents <= 0) continue;
    items.push({
      id: `gift-${card.id}`,
      actor: 'A gift for you',
      title: 'A gift card was added',
      detail: `${money(card.balanceCents)} available`,
      at: card.createdAt,
      target: { kind: 'gift-balance' },
      action: 'Redeem',
    });
  }

  return items;
}

/** The workspace feed: orders awaiting confirmation, then ones ready to bill. */
export function buildStaffNotifications(dashboard: StaffDashboard, now: Date): NotificationItem[] {
  const items: NotificationItem[] = [];

  for (const order of dashboard.orders) {
    const dueAt = new Date(order.scheduledFor ?? order.placedAt);
    if (order.status === 'created' && dueAt.getTime() > now.getTime()) {
      items.push({
        id: `confirm-${order.id}`,
        actor: order.guestLabel ?? 'Guest',
        title: 'needs confirmation',
        detail: `${order.summary} · ${formatWhen(order.scheduledFor ?? order.placedAt)}`,
        at: new Date(dueAt.getTime() - DAY).toISOString(),
        target: { kind: 'confirm-order', orderId: order.id },
        action: 'Confirm',
      });
    }
    if (order.status === 'paid' && dueAt.getTime() < now.getTime() && order.totalCents > 0) {
      items.push({
        id: `checkout-${order.id}`,
        actor: order.guestLabel ?? 'Guest',
        title: 'is ready to check out',
        detail: `${order.summary} · ${money(order.totalCents)} due`,
        at: order.scheduledFor ?? order.placedAt,
        target: { kind: 'staff-checkout' },
        action: 'Check out',
      });
    }
  }

  return items;
}

function formatWhen(at: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}
