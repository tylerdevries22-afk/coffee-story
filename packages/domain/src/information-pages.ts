/**
 * The five reference pages behind More.
 *
 * These used to be one frozen constant holding Coffee Story's address, phone
 * number, roaster and prayer room -- shipped inside the shared engine, which
 * meant the second tenant's app would have told its guests to visit a shop in
 * Aurora, Colorado. The keys are navigation destinations (`navigation-state`
 * routes to all five, and `_layout` deep-links them), so a page can never be
 * absent; only its content is the tenant's.
 *
 * The location page is derived rather than written: address, hours and phone
 * are already structured fields in brand.json, and asking a tenant to retype
 * them into prose is how the printed hours and the real hours drift apart.
 * Everything else has a brand-neutral default that names the brand and says
 * only what is true of any shop running this platform.
 */
export type InformationPageKey = 'location' | 'resources' | 'faq' | 'order-policy' | 'privacy';

export type InformationRow = { title: string; detail: string };

export type InformationPageConfig = {
  eyebrow: string;
  title: string;
  summary: string;
  rows: readonly InformationRow[];
  webPath?: string;
  action?: string;
};

export const INFORMATION_PAGE_KEYS: readonly InformationPageKey[] = [
  'location', 'resources', 'faq', 'order-policy', 'privacy',
];

/** Two-letter-ish day keys as brand.json writes them, in reading order. */
const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
] as const;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function rowsOf(value: unknown): InformationRow[] {
  if (!Array.isArray(value)) return [];
  const rows: InformationRow[] = [];
  for (const entry of value) {
    const title = text(record(entry).title);
    const detail = text(record(entry).detail);
    if (title && detail) rows.push({ title, detail });
  }
  return rows;
}

/**
 * "8am" and "12am", not "08:00" and "24:00".
 *
 * brand.json writes a close past midnight as 24:00 or 25:30 so that a span is
 * always ordered and comparable; a guest reading a shop door has never seen
 * either. Anything unparseable is returned as written rather than guessed at,
 * because a wrong closing time is worse than an odd-looking one.
 */
export function formatClockLabel(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return value;
  const wrapped = hours % 24;
  const suffix = wrapped < 12 ? 'am' : 'pm';
  const twelve = wrapped % 12 === 0 ? 12 : wrapped % 12;
  return minutes === 0 ? `${twelve}${suffix}` : `${twelve}:${match[2]}${suffix}`;
}

/**
 * A day's opening, or null when the tenant has not said.
 *
 * An absent key and an empty array are deliberately different. `[]` is a shop
 * declaring itself closed that day; a missing key is a brand.json nobody has
 * finished filling in, and printing "Sunday Closed" over that sends a guest
 * away from a shop that was open. Not knowing propagates up and the hours line
 * is simply omitted.
 */
function spanLabel(spans: unknown): string | null {
  if (!Array.isArray(spans)) return null;
  if (spans.length === 0) return 'Closed';
  const parts: string[] = [];
  for (const span of spans) {
    const open = text(record(span).open);
    const close = text(record(span).close);
    if (open && close) parts.push(`${formatClockLabel(open)}–${formatClockLabel(close)}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * The week, collapsed onto its runs.
 *
 * A shop open the same hours all week should read "Every day 8am–11pm", not
 * seven identical lines; one that differs at the weekend should say so once.
 * Consecutive days sharing a span are therefore merged, which is how the hours
 * are written on the door.
 */
export function summarizeWeek(hours: unknown): string | null {
  const week = record(hours);
  const labels: { day: string; span: string }[] = [];
  for (const [key, name] of DAYS) {
    const span = spanLabel(week[key]);
    if (span === null) return null;
    labels.push({ day: name, span });
  }
  if (labels.length === 0) return null;
  if (labels.every((entry) => entry.span === labels[0]?.span)) {
    return labels[0]?.span === 'Closed' ? null : `Every day ${labels[0]?.span}`;
  }
  const runs: { from: string; to: string; span: string }[] = [];
  for (const entry of labels) {
    const last = runs[runs.length - 1];
    if (last && last.span === entry.span) last.to = entry.day;
    else runs.push({ from: entry.day, to: entry.day, span: entry.span });
  }
  return runs
    .map((run) => `${run.from === run.to ? run.from : `${run.from}–${run.to}`} ${run.span}`)
    .join(' · ');
}

function addressLine(address: unknown): string | null {
  const parts = record(address);
  const street = text(parts.street);
  const city = text(parts.city);
  const region = text(parts.region);
  const postal = text(parts.postal);
  const locality = [city, [region, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const line = [street, locality].filter((value) => value && value !== '').join(', ');
  return line === '' ? null : line;
}

type BrandFacts = {
  brandName: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
};

function factsOf(config: unknown): BrandFacts {
  const source = record(config);
  const identity = record(source.identity);
  const business = record(source.business);
  const location = record(source.location);
  return {
    brandName: text(identity.name) ?? text(location.name) ?? text(business.legalName) ?? 'the shop',
    tagline: text(business.tagline),
    phone: text(business.phone),
    email: text(business.email),
    address: addressLine(location.address),
    hours: summarizeWeek(location.hours),
  };
}

function defaults(facts: BrandFacts): Record<InformationPageKey, InformationPageConfig> {
  const contact = [facts.address, facts.phone].filter(Boolean).join(' · ');
  const locationRows: InformationRow[] = [];
  if (contact !== '') locationRows.push({ title: 'Where we are', detail: contact });
  if (facts.hours) locationRows.push({ title: 'Opening hours', detail: facts.hours });
  if (facts.email) locationRows.push({ title: 'Get in touch', detail: facts.email });

  return {
    location: {
      eyebrow: facts.tagline ?? 'Visit us',
      title: 'Shop location & hours',
      summary: `Where to find ${facts.brandName}, and when we are open.`,
      rows: locationRows,
      webPath: '/location',
      action: 'Open directions & shop details',
    },
    resources: {
      eyebrow: 'Our story',
      title: 'Our story & guides',
      summary: `A little more about ${facts.brandName}.`,
      rows: [
        { title: 'About us', detail: `${facts.brandName} is on this app so you can order ahead, earn on what you buy, and pick up without waiting in line.` },
      ],
      webPath: '/resources',
      action: 'Read the full story',
    },
    faq: {
      eyebrow: 'Answers',
      title: 'Frequently asked questions',
      summary: 'Tap a question to read the answer without leaving the app.',
      rows: [
        { title: 'How do I order ahead?', detail: 'Build your order in the app and pay; the counter starts it and the pickup board calls your name when it is ready.' },
        { title: 'How do gift cards work?', detail: 'Gift cards never expire and can be claimed in the app or presented at the counter.' },
        { title: 'Can I use rewards with a gift card?', detail: 'Eligible rewards can be applied at checkout. Amounts paid with stored value do not earn additional points.' },
      ],
      webPath: '/faq',
      action: 'Read every FAQ',
    },
    'order-policy': {
      eyebrow: 'Good to know',
      title: 'Order & refund policy',
      summary: 'Every order is made when you place it.',
      rows: [
        { title: 'Changing an order', detail: 'Pickup orders can be changed or cancelled until preparation begins — usually within a few minutes of ordering.' },
        { title: 'Something not right?', detail: 'Tell us at the counter or message us in the app and we will make it right.' },
        { title: 'Refunds', detail: 'Approved refunds return to the original payment method within 3–5 business days.' },
      ],
      webPath: '/what-to-expect',
      action: 'Read the full policy',
    },
    privacy: {
      eyebrow: 'Your information',
      title: 'Privacy & terms',
      summary: 'Your information is used only to operate your account, orders, payments, and rewards.',
      rows: [
        { title: 'Account details', detail: `Preferences and private messages are restricted to authorized members of the ${facts.brandName} team.` },
        { title: 'Payments', detail: 'Card details are handled by the payment provider and are not stored directly in the app.' },
        { title: 'Account control', detail: 'You can request a copy or deletion of eligible account information by contacting the shop.' },
      ],
      webPath: '/privacy',
      action: 'Read the complete privacy notice',
    },
  };
}

/**
 * `rows` replaces the defaults; `addRows` appends to whatever is in effect.
 *
 * Both exist because the two pages want opposite things. The FAQ is entirely
 * the tenant's, so it replaces. The location page is derived from fields the
 * tenant already maintains, and a shop wanting to add "free parking, and a
 * prayer room" should not have to retype its own address to say so.
 */
function merge(base: InformationPageConfig, override: unknown): InformationPageConfig {
  const source = record(override);
  const replaced = rowsOf(source.rows);
  const rows = replaced.length > 0 ? replaced : base.rows;
  const appended = rowsOf(source.addRows);
  return {
    eyebrow: text(source.eyebrow) ?? base.eyebrow,
    title: text(source.title) ?? base.title,
    summary: text(source.summary) ?? base.summary,
    rows: appended.length > 0 ? [...rows, ...appended] : rows,
    webPath: text(source.webPath) ?? base.webPath,
    action: text(source.action) ?? base.action,
  };
}

/**
 * Every page, for this tenant. Never partial: the keys are routes.
 */
export function resolveInformationPages(
  config: unknown,
): Readonly<Record<InformationPageKey, InformationPageConfig>> {
  const base = defaults(factsOf(config));
  const overrides = record(record(config).information);
  const resolved = {} as Record<InformationPageKey, InformationPageConfig>;
  for (const key of INFORMATION_PAGE_KEYS) {
    resolved[key] = merge(base[key], overrides[key]);
  }
  return resolved;
}
