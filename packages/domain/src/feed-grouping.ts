import type { NotificationItem, NotificationSection } from './feed-types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

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
