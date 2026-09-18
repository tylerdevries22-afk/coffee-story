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
 * Hours arrive per day, as the hours editor posts them from both the
 * new-organization wizard and the new-location page: few businesses keep the
 * same hours on a Saturday, and a Google listing says so. What a span may say
 * -- overnight, around the clock -- is defined once, in location-hours.ts.
 */
import {
  coordinatesOf, phoneOf, placeIdOf, websiteFromInput,
} from './location-contact';
import { hoursSummary, parseHoursByDay, type HoursByDay } from './location-hours';

export type { HoursByDay, Weekday } from './location-hours';

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
  /** Per-day spans: the hours editor's week as JSON, or the object itself. */
  hours?: unknown;
  googlePlaceId?: string;
  lat?: string | number;
  lng?: string | number;
  phone?: string;
  website?: string;
};
export type LocationValidationField =
  | 'name' | 'timezone' | 'hours' | 'googlePlaceId' | 'coordinates' | 'phone' | 'website';
type LocationFailure = { ok: false; error: string; field: LocationValidationField };

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

  // No week at all is refused like a malformed one, never defaulted: a
  // default would quietly set hours the operator never saw.
  const hours = parseHoursByDay(input.hours);
  if (!hours.ok) return { ok: false, field: 'hours', error: hours.error };

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

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * The new-location page's form, read into the parser's input: its own fields
 * and nothing else. The page asks for no Place id, map pin, phone or website,
 * so none of them is read from a post either.
 */
export function newLocationInputFromForm(data: FormData): LocationInput {
  return {
    name: text(data, 'name'), street: text(data, 'street'), city: text(data, 'city'),
    region: text(data, 'region'), postal: text(data, 'postal'), timezone: text(data, 'timezone'),
    // The hours editor's week, as JSON: every day, a closed one as an empty list.
    hours: text(data, 'hours'),
  };
}
