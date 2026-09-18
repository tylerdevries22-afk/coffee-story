/**
 * Field-level readers for one Places API (New) `Place`.
 *
 * Every reader is total. The response makes every field optional, so a missing
 * or malformed value becomes null or an empty list rather than an exception: a
 * place with no published phone number is an ordinary place, not a failed
 * lookup.
 */
export type PlaceCoordinates = { readonly lat: number; readonly lng: number };

/** An address split the way a location form holds it. */
export type PlaceAddress = {
  readonly street: string | null;
  readonly city: string | null;
  /** Short form, as a postal address writes it: `CO`, not `Colorado`. */
  readonly region: string | null;
  readonly postal: string | null;
  /** ISO 3166-1 alpha-2, e.g. `US`. */
  readonly country: string | null;
};

/**
 * One regular opening span, in Google's day numbering (0 = Sunday).
 *
 * A null close means open around the clock from this point on, which is how
 * Google encodes a place that never closes.
 */
export type PlaceOpeningPeriod = {
  readonly openDay: number;
  readonly open: string;
  readonly closeDay: number | null;
  readonly close: string | null;
};

export type PlaceBusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** A finite number, or null. Rejects NaN, which `typeof` calls a number. */
export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function coordinates(value: unknown): PlaceCoordinates | null {
  if (!isRecord(value)) return null;
  const lat = finite(value.latitude);
  const lng = finite(value.longitude);
  // A partial coordinate is worse than none: it would place a property on the
  // equator or the prime meridian rather than admit it does not know.
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((entry): entry is string => entry !== null);
}

export function photoNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((photo) => (isRecord(photo) ? text(photo.name) : null))
    .filter((name): name is string => name !== null);
}

/** An https link, or null. These are drawn as buttons; a script URL must not be one. */
export function httpsUri(value: unknown): string | null {
  const candidate = text(value);
  if (candidate === null) return null;
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

const STATUSES: ReadonlySet<string> = new Set(['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY']);

export function businessStatus(value: unknown): PlaceBusinessStatus | null {
  const status = text(value);
  return status !== null && STATUSES.has(status) ? status as PlaceBusinessStatus : null;
}

/** An IANA zone the runtime can actually use, or null. */
export function timeZoneId(value: unknown): string | null {
  const id = isRecord(value) ? text(value.id) : null;
  if (id === null) return null;
  try {
    return Intl.DateTimeFormat('en-US', { timeZone: id }).resolvedOptions().timeZone ? id : null;
  } catch {
    return null;
  }
}

type Component = { readonly long: string; readonly short: string; readonly types: readonly string[] };

function components(value: unknown): readonly Component[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const long = text(entry.longText);
    return long === null ? [] : [{ long, short: text(entry.shortText) ?? long, types: strings(entry.types) }];
  });
}

/**
 * Splits `addressComponents` into the fields a location form holds.
 *
 * `formattedAddress` alone could not autofill anything: it is one display
 * string, and nothing splits "1 Example St, Georgetown, CO 80444, USA"
 * reliably. Components arrive typed. The street is number-then-route, the US
 * order, because the outreach this serves is geo-fenced to the US.
 */
export function address(value: unknown): PlaceAddress {
  const parts = components(value);
  const first = (...types: string[]): Component | undefined => {
    for (const type of types) {
      const hit = parts.find((part) => part.types.includes(type));
      if (hit) return hit;
    }
    return undefined;
  };
  const street = [first('street_number')?.long, first('route')?.long].filter(Boolean).join(' ');
  return {
    street: street || null,
    city: first('locality', 'postal_town', 'sublocality_level_1', 'administrative_area_level_3')?.long ?? null,
    region: first('administrative_area_level_1')?.short ?? null,
    postal: first('postal_code')?.long ?? null,
    country: first('country')?.short ?? null,
  };
}

function clock(value: unknown): { day: number; time: string } | null {
  if (!isRecord(value)) return null;
  // Proto3 JSON drops zero values, so "Sunday at midnight" can arrive as {}.
  // A missing day, hour or minute is therefore 0, never "unknown".
  const [day, hour, minute] = [value.day, value.hour, value.minute]
    .map((part) => (part === undefined ? 0 : finite(part)));
  if (day == null || hour == null || minute == null) return null;
  if (![day, hour, minute].every(Number.isInteger)) return null;
  if (day < 0 || day > 6 || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  if (hour === 24 && minute !== 0) return null;
  return { day, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

/** `regularOpeningHours.periods`, which the wizard can fill hours from. */
export function openingPeriods(value: unknown): readonly PlaceOpeningPeriod[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const open = clock(entry.open);
    if (open === null) return [];
    const close = entry.close === undefined ? null : clock(entry.close);
    // A close that is present but unreadable is not "open around the clock".
    if (entry.close !== undefined && close === null) return [];
    return [{ openDay: open.day, open: open.time, closeDay: close?.day ?? null, close: close?.time ?? null }];
  });
}
