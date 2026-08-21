import type { BookingService, GiftCard, PortalAppointment, PortalBundle } from '@/types/domain';

/**
 * One row in the client search sheet.
 *
 * `target` is the only thing the caller acts on: a More destination it should
 * open (`view`, the `MoreView` key or `book` for the booking flow), or a
 * bookable service slug it should start a booking for.
 */
export type ClientSearchResult = {
  id: string;
  kind: 'page' | 'visit' | 'gift' | 'service';
  title: string;
  detail: string;
  /** What the caller should open. */
  target: { view: string } | { serviceId: string };
};

/**
 * Every destination the client More page can reach, in the order that page
 * lists them. Titles and subtitles are kept in step with
 * `src/screens/client/more-screen.tsx` so a member searching for the words
 * they can see on that page finds the page.
 *
 * `book` is not a `MoreView`: the More page opens Services & pricing through
 * the booking flow rather than a sub-page, and the caller routes it the same
 * way.
 */
const PAGES: readonly { view: string; title: string; detail: string }[] = [
  { view: 'gift-balance', title: 'Gift card balance', detail: 'Stored value, claimed cards, and gifts you sent' },
  { view: 'book', title: 'Services & pricing', detail: 'Book a session and compare durations and prices' },
  { view: 'location', title: 'Studio location', detail: 'Greenwood Village, Colorado, with arrival and parking notes' },
  { view: 'resources', title: 'Wellness resources', detail: 'Before your session, aftercare, and when to reschedule' },
  { view: 'faq', title: 'Frequently asked questions', detail: 'Answers about sessions, gift cards, and rewards' },
  { view: 'care-policy', title: 'Cancellation policy', detail: 'Changes, late arrival, and emergency exceptions' },
  { view: 'privacy', title: 'Privacy & terms', detail: 'Care records, payments, and account control' },
  { view: 'visits', title: 'Appointments & visit history', detail: 'Upcoming and past visits' },
  { view: 'profile', title: 'Account settings', detail: 'Name, email, phone, and birthday' },
  { view: 'intake', title: 'Intake & consent', detail: 'Concerns, pressure preference, and consent' },
  { view: 'messages', title: 'Messages', detail: 'Private conversation with the studio' },
  { view: 'membership', title: 'Membership', detail: 'Plan status, credits, and renewal date' },
  { view: 'payments', title: 'Payment methods', detail: 'Saved cards for secure checkout' },
];

/** Result ceiling, so the sheet stays a shortlist rather than a directory. */
const RESULT_LIMIT = 12;

function formatVisitDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function matches(needle: string, title: string, detail: string): boolean {
  return `${title} ${detail}`.toLowerCase().includes(needle);
}

function visitResult(appointment: PortalAppointment): ClientSearchResult {
  return {
    id: `visit-${appointment.id}`,
    kind: 'visit',
    title: appointment.serviceName,
    detail: `${formatVisitDate(appointment.startsAt)} · ${appointment.status.replace('_', ' ')}`,
    target: { view: 'visits' },
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

function serviceResult(service: BookingService): ClientSearchResult {
  const price = `$${Math.round(service.priceCents / 100)}`;
  const description = service.description ? ` · ${service.description}` : '';
  return {
    id: `service-${service.slug}`,
    kind: 'service',
    title: service.name,
    detail: `${service.durationMin} min · ${price}${description}`,
    target: { serviceId: service.slug },
  };
}

/**
 * Case-insensitive substring search across a client's own account: the More
 * destinations, their visits, their gift cards, and the bookable services.
 *
 * An empty or whitespace-only query returns nothing rather than everything —
 * the search sheet opens blank, and dumping the whole account into it would
 * read as a result set the member never asked for. Results are grouped pages,
 * visits, gifts, services and capped at twelve.
 */
export function searchClientAccount(
  query: string,
  portal: PortalBundle,
  services: readonly BookingService[],
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

  const visits = portal.appointments
    .map(visitResult)
    .filter((result) => matches(needle, result.title, result.detail));

  const gifts = portal.giftCards
    .map(giftResult)
    .filter((result) => matches(needle, result.title, result.detail));

  const bookable = services
    .map(serviceResult)
    .filter((result) => matches(needle, result.title, result.detail));

  return [...pages, ...visits, ...gifts, ...bookable].slice(0, RESULT_LIMIT);
}
