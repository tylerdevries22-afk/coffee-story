import { formatMoney } from './money';
import type { OrderableItem, GiftCard, PortalOrder, PortalBundle } from './domain';

/**
 * One row in the client search sheet.
 *
 * `target` is the only thing the caller acts on: a More destination it should
 * open (`view`, the `MoreView` key or `book` for the order flow), or a
 * menu item slug it should start an order for.
 */
export type ClientSearchResult = {
  id: string;
  kind: 'page' | 'order' | 'gift' | 'item';
  title: string;
  detail: string;
  /** What the caller should open. */
  target: { view: string } | { itemId: string };
};

/**
 * Every destination the client More page can reach, in the order that page
 * lists them. Titles and subtitles are kept in step with
 * `src/screens/client/more-screen.tsx` so a member searching for the words
 * they can see on that page finds the page.
 *
 * `book` is not a `MoreView`: the More page opens Items & pricing through
 * the order flow rather than a sub-page, and the caller routes it the same
 * way.
 */
const PAGES: readonly { view: string; title: string; detail: string }[] = [
  { view: 'gift-balance', title: 'Gift card balance', detail: 'Stored value, claimed cards, and gifts you sent' },
  { view: 'book', title: 'Menu & prices', detail: 'Browse signature lattes and the full menu, with sizes and prices' },
  { view: 'location', title: 'Shop location & hours', detail: 'Aurora, Colorado, with parking, Wi-Fi, and late-night hours' },
  { view: 'resources', title: 'Our story & brewing guides', detail: 'Our roaster, the halal-friendly menu, and staying a while' },
  { view: 'faq', title: 'Frequently asked questions', detail: 'Answers about the coffee menu, gift cards, and rewards' },
  { view: 'order-policy', title: 'Order & refund policy', detail: 'Changes, late pickup, and refund exceptions' },
  { view: 'privacy', title: 'Privacy & terms', detail: 'Order records, payments, and account control' },
  { view: 'orders', title: 'Orders & pickup history', detail: 'Current and past coffee orders' },
  { view: 'profile', title: 'Account settings', detail: 'Name, email, phone, and birthday' },
  { view: 'preferences', title: 'My usual & preferences', detail: 'Favourite drink, strength, and milk preference' },
  { view: 'messages', title: 'Messages', detail: 'Private conversation with the shop' },
  { view: 'membership', title: 'Membership', detail: 'Plan status, credits, and renewal date' },
  { view: 'payments', title: 'Payment methods', detail: 'Saved cards for secure checkout' },
];

/** Result ceiling, so the sheet stays a shortlist rather than a directory. */
const RESULT_LIMIT = 12;

function formatOrderDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function matches(needle: string, title: string, detail: string): boolean {
  return `${title} ${detail}`.toLowerCase().includes(needle);
}

function orderResult(order: PortalOrder): ClientSearchResult {
  return {
    id: `order-${order.id}`,
    kind: 'order',
    title: order.summary,
    detail: `${formatOrderDate(order.placedAt)} · ${order.status.replace('_', ' ')}`,
    target: { view: 'orders' },
  };
}

function giftResult(gift: GiftCard): ClientSearchResult {
  const ownership = gift.claimedByCurrentUser
    ? 'claimed by you'
    : gift.purchasedByCurrentUser ? 'sent by you' : gift.status;
  return {
    id: `gift-${gift.id}`,
    kind: 'gift',
    title: gift.code,
    detail: `${formatDollars(gift.balanceCents)} available · ${ownership}`,
    target: { view: 'gift-balance' },
  };
}

function itemResult(item: OrderableItem): ClientSearchResult {
  const description = item.description ? ` · ${item.description}` : '';
  // Food has no volume, so the size is omitted rather than printed as a zero.
  const size = item.ounces ? `${item.ounces} oz · ` : '';
  return {
    id: `item-${item.slug}`,
    kind: 'item',
    title: item.name,
    detail: `${size}${formatMoney(item.priceCents)}${description}`,
    target: { itemId: item.slug },
  };
}

/**
 * Case-insensitive substring search across a client's own account: the More
 * destinations, their orders, their gift cards, and the bookable items.
 *
 * An empty or whitespace-only query returns nothing rather than everything —
 * the search sheet opens blank, and dumping the whole account into it would
 * read as a result set the member never asked for. Results are grouped pages,
 * orders, gifts, items and capped at twelve.
 */
export function searchClientAccount(
  query: string,
  portal: PortalBundle,
  items: readonly OrderableItem[],
): ClientSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const pages: ClientSearchResult[] = PAGES
    .filter((page) => matches(needle, page.title, page.detail))
    .map((page) => ({
      id: `page-${page.view}`,
      kind: 'page',
      title: page.title,
      detail: page.detail,
      target: { view: page.view },
    }));

  const orders = portal.orders
    .map(orderResult)
    .filter((result) => matches(needle, result.title, result.detail));

  const gifts = portal.giftCards
    .map(giftResult)
    .filter((result) => matches(needle, result.title, result.detail));

  const bookable = items
    .map(itemResult)
    .filter((result) => matches(needle, result.title, result.detail));

  return [...pages, ...orders, ...gifts, ...bookable].slice(0, RESULT_LIMIT);
}
