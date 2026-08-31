/**
 * Parsing and validating the "add a location" form into the shapes the
 * locations row needs: an address JSONB, an hours JSONB keyed by weekday, the
 * IANA timezone, and a human summary the demo list can print. Kept pure and
 * asset-free so it is unit-tested without a database or a renderer, and so the
 * same validation guards both the demo and the live write.
 *
 * A new location starts blank on purpose -- no inherited copy, no carried-over
 * contact, only what the operator typed -- which is what "franchise ready from
 * a blank slate" means.
 */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type HoursByDay = Partial<Record<Weekday, { open: string; close: string }[]>>;

export type LocationDraft = {
  readonly name: string;
  readonly address: { street?: string; city?: string; region?: string; postal?: string };
  readonly timezone: string;
  readonly hours: HoursByDay;
  readonly hoursSummary: string;
  readonly city: string;
};

export type LocationInput = {
  name?: string;
  street?: string;
  city?: string;
  region?: string;
  postal?: string;
  timezone?: string;
  openTime?: string;
  closeTime?: string;
  days?: readonly string[];
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// IANA-ish shape first; Intl below remains the authority for actual tz data.
const TIMEZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;
const DAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function isIanaTimezone(value: string): boolean {
  if (!TIMEZONE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the form, or return the first thing an operator has to fix. On
 * success it returns the row-ready draft; the hours span is applied to every
 * selected day, the quick start a single set of opening hours covers.
 */
export function parseLocationDraft(input: LocationInput): { ok: true; draft: LocationDraft } | { ok: false; error: string } {
  const name = clean(input.name);
  if (!name) return { ok: false, error: 'Enter a location name.' };
  if (name.length > 120) return { ok: false, error: 'That location name is too long.' };

  const timezone = clean(input.timezone);
  if (!isIanaTimezone(timezone)) return { ok: false, error: 'Choose the location’s timezone.' };

  const open = clean(input.openTime);
  const close = clean(input.closeTime);
  if (!TIME.test(open) || !TIME.test(close)) return { ok: false, error: 'Enter opening and closing times as HH:MM.' };
  if (open >= close) return { ok: false, error: 'Closing time has to be after opening time.' };

  const requested = new Set((input.days ?? []).map((day) => day.toLowerCase()));
  const openDays = WEEKDAYS.filter((day) => requested.has(day));
  if (openDays.length === 0) return { ok: false, error: 'Pick at least one day the location is open.' };

  const hours: HoursByDay = {};
  for (const day of openDays) hours[day] = [{ open, close }];

  const address = {
    street: clean(input.street) || undefined,
    city: clean(input.city) || undefined,
    region: clean(input.region) || undefined,
    postal: clean(input.postal) || undefined,
  };

  const summary = `${openDays.map((day) => DAY_LABEL[day]).join(' ')} ${open}–${close}`;

  return {
    ok: true,
    draft: { name, address, timezone, hours, hoursSummary: summary, city: address.city ?? '' },
  };
}
