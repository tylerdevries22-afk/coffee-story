/**
 * Parsing and validating the "add a location" form into the shapes the
 * locations row needs: an address JSONB, an hours JSONB keyed by weekday, the
 * IANA timezone, and a human summary the demo list can print. Kept pure and
 * asset-free so it is unit-tested without a database or a renderer, and so the
 * same validation guards both the demo and the live write.
 *
 * A new location starts blank on purpose -- no inherited copy, no carried-over
 * contact, only what the operator typed or confirmed -- which is what
 * "franchise ready from a blank slate" means.
 *
 * Hours arrive one of two ways: the quick form (one span applied to every
 * checked day) or per-day spans, which is what a Google listing needs, since
 * few businesses keep the same hours on a Saturday. What a span may say --
 * overnight, around the clock -- is defined once, in location-hours.ts.
 */
import {
  coordinatesOf, phoneOf, placeIdOf, websiteFromInput,
} from './location-contact';
import {
  hoursSummary, isClock, NO_OPEN_DAY, parseHoursByDay, SPAN_ISSUES, WEEKDAYS, type HoursByDay,
} from './location-hours';

export { WEEKDAYS, type HoursByDay, type Weekday } from './location-hours';

export type LocationAddress = {
  street?: string;
  city?: string;
  region?: string;
  postal?: string;
  /** Where Google puts the location; the column's documented shape keeps lat/lng with the address. */
  lat?: number;
  lng?: number;
};

export type LocationDraft = {
  readonly name: string;
  readonly address: LocationAddress;
  readonly timezone: string;
  readonly hours: HoursByDay;
  readonly hoursSummary: string;
  readonly city: string;
  /** The Google Place this location is, when the wizard found it there. */
  readonly googlePlaceId: string | null;
  readonly phone: string | null;
  readonly website: string | null;
};

export type LocationInput = {
  name?: string;
  street?: string;
  city?: string;
  region?: string;
  postal?: string;
  timezone?: string;
  /** The quick form: one span, applied to every day in `days`. */
  openTime?: string;
  closeTime?: string;
  days?: readonly string[];
  /** Per-day spans (JSON, or the object itself). When present they replace the quick form. */
  hours?: unknown;
  googlePlaceId?: string;
  lat?: string | number;
  lng?: string | number;
  phone?: string;
  website?: string;
};
export type LocationValidationField =
  | 'name' | 'timezone' | 'openTime' | 'closeTime' | 'days' | 'hours'
  | 'googlePlaceId' | 'coordinates' | 'phone' | 'website';
type LocationFailure = { ok: false; error: string; field: LocationValidationField };
type HoursResult = { ok: true; hours: HoursByDay } | LocationFailure;

// IANA-ish shape first; Intl below remains the authority for actual tz data.
const TIMEZONE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;

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

/** The quick form: one span, the same on every checked day. */
function quickHours(input: LocationInput): HoursResult {
  const open = clean(input.openTime);
  const close = clean(input.closeTime);
  if (!isClock(open) || !isClock(close)) {
    return { ok: false, field: !isClock(open) ? 'openTime' : 'closeTime',
      error: 'Enter opening and closing times as HH:MM.' };
  }
  // A close before the open is an overnight span, not a mistake; only a
  // span that opens and closes at the same minute says nothing usable.
  if (open === close) return { ok: false, field: 'closeTime', error: SPAN_ISSUES.same_minute };
  const requested = new Set((input.days ?? []).map((day) => day.toLowerCase()));
  const openDays = WEEKDAYS.filter((day) => requested.has(day));
  if (openDays.length === 0) return { ok: false, field: 'days', error: NO_OPEN_DAY };
  const hours: HoursByDay = {};
  for (const day of openDays) hours[day] = [{ open, close }];
  return { ok: true, hours };
}

function hoursOf(input: LocationInput): HoursResult {
  const raw = input.hours;
  const given = typeof raw === 'string' ? raw.trim() !== '' : raw !== undefined && raw !== null;
  if (!given) return quickHours(input);
  const parsed = parseHoursByDay(raw);
  return parsed.ok ? parsed : { ok: false, field: 'hours', error: parsed.error };
}

/**
 * Validate the form, or return the first thing an operator has to fix. On
 * success it returns the row-ready draft.
 */
export function parseLocationDraft(input: LocationInput): { ok: true; draft: LocationDraft } | LocationFailure {
  const name = clean(input.name);
  if (!name) return { ok: false, field: 'name', error: 'Enter a location name.' };
  if (name.length > 120) return { ok: false, field: 'name', error: 'That location name is too long.' };

  const timezone = clean(input.timezone);
  if (!isIanaTimezone(timezone)) {
    return { ok: false, field: 'timezone', error: 'Choose the location’s timezone.' };
  }

  const hours = hoursOf(input);
  if (!hours.ok) return hours;

  const placeId = placeIdOf(input.googlePlaceId);
  if (!placeId.ok) return { ok: false, field: 'googlePlaceId', error: placeId.error };
  const coordinates = coordinatesOf(input.lat, input.lng);
  if (!coordinates.ok) return { ok: false, field: 'coordinates', error: coordinates.error };
  const phone = phoneOf(input.phone);
  if (!phone.ok) return { ok: false, field: 'phone', error: phone.error };
  const website = websiteFromInput(input.website);
  if (!website.ok) return { ok: false, field: 'website', error: website.error };

  const address: LocationAddress = {
    street: clean(input.street) || undefined,
    city: clean(input.city) || undefined,
    region: clean(input.region) || undefined,
    postal: clean(input.postal) || undefined,
    ...(coordinates.value ?? {}),
  };

  return {
    ok: true,
    draft: {
      name, address, timezone, hours: hours.hours, hoursSummary: hoursSummary(hours.hours),
      city: address.city ?? '', googlePlaceId: placeId.value, phone: phone.value,
      website: website.value,
    },
  };
}
