/**
 * What a picked Google listing fills in across the wizard, and which of those
 * fields still show Google's value.
 *
 * A field is "from Google" from the moment a place fills it until the operator
 * edits it; that state is the review cue, so it has to be exact -- a field
 * Google left empty is never marked, and an edited one never stays marked.
 * Pure and browser-safe: the wizard imports it, so it may only import types
 * from the server-side mapping.
 */
import { WEEKDAYS, type HoursByDay } from './location-hours';
import type { PlaceDraft } from './place-to-draft';

export type PrefillField =
  | 'name' | 'website' | 'locationName' | 'street' | 'city' | 'region' | 'postal'
  | 'timezone' | 'phone' | 'hours' | 'industry';

export type PlacePrefill = {
  /** Remounts the prefilled inputs when a different place is picked. */
  readonly key: string;
  /** Null when the operator chose to enter the details by hand. */
  readonly draft: PlaceDraft | null;
  readonly fromGoogle: ReadonlySet<PrefillField>;
};

/** The zones the form offers before a place names its own. */
export const TIMEZONES: readonly string[] = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'Europe/London', 'Europe/Paris', 'Australia/Sydney',
];
export const DEFAULT_TIMEZONE = 'America/Denver';

function weekdayHours(): HoursByDay {
  const hours: HoursByDay = {};
  for (const day of WEEKDAYS.slice(0, 5)) hours[day] = [{ open: '08:00', close: '17:00' }];
  return hours;
}

/** Weekdays 08:00–17:00: where a location typed by hand starts, in the wizard and on the new-location page. */
export const DEFAULT_HOURS: Readonly<HoursByDay> = weekdayHours();

/** The listed zones, with the place's own first when the list does not have it. */
export function timezoneOptions(zone: string | null | undefined): readonly string[] {
  return zone && !TIMEZONES.includes(zone) ? [zone, ...TIMEZONES] : TIMEZONES;
}

export function googleFieldsOf(draft: PlaceDraft): ReadonlySet<PrefillField> {
  const filled: PrefillField[] = ['name', 'locationName', 'industry'];
  const optional: readonly [PrefillField, unknown][] = [
    ['website', draft.website], ['street', draft.street], ['city', draft.city],
    ['region', draft.region], ['postal', draft.postal], ['timezone', draft.timezone],
    ['phone', draft.phone], ['hours', draft.hours],
  ];
  for (const [field, value] of optional) if (value !== null) filled.push(field);
  return new Set(filled);
}

export function prefillFromPlace(draft: PlaceDraft, pick: number): PlacePrefill {
  return { key: `${draft.googlePlaceId}:${pick}`, draft, fromGoogle: googleFieldsOf(draft) };
}

export const MANUAL_PREFILL: PlacePrefill = { key: 'manual', draft: null, fromGoogle: new Set() };

/** The same prefill with one field handed over to the operator. */
export function editedField(prefill: PlacePrefill, field: PrefillField): PlacePrefill {
  if (!prefill.fromGoogle.has(field)) return prefill;
  const fromGoogle = new Set(prefill.fromGoogle);
  fromGoogle.delete(field);
  return { ...prefill, fromGoogle };
}

const ADDRESS_FIELDS: readonly PrefillField[] = ['street', 'city', 'region', 'postal'];

/**
 * The listing's map pin, for as long as the address is still the listing's.
 * Once the operator rewrites any part of the address Google filled, the pin
 * would mark a place nobody typed, so the form posts none; filling in a part
 * Google left empty keeps it.
 */
export function placeCoordinates(prefill: PlacePrefill): { readonly lat: string; readonly lng: string } {
  const { draft } = prefill;
  if (!draft || draft.lat === null || draft.lng === null) return { lat: '', lng: '' };
  const filled = googleFieldsOf(draft);
  const rewritten = ADDRESS_FIELDS.some((field) => filled.has(field) && !prefill.fromGoogle.has(field));
  return rewritten ? { lat: '', lng: '' } : { lat: String(draft.lat), lng: String(draft.lng) };
}

/** A permanently closed listing waits for the operator to confirm it before anything is filled. */
export function needsConfirmation(draft: PlaceDraft): boolean {
  return draft.warnings.some((warning) => warning.code === 'closed_permanently');
}
