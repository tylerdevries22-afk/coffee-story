/**
 * The subset of a Google Place this platform stores or draws.
 *
 * Deliberately narrow. A lobby screen shows a property's identity, where it is,
 * how to reach it and when it is open; nothing here carries a review body, a
 * user's name, or anything else that would make this a copy of someone else's
 * content rather than a pointer at it. The field mask in `places.ts` is built
 * from exactly these fields, so the request cannot quietly widen.
 */
export type PlaceCoordinates = { readonly lat: number; readonly lng: number };

export type PlaceDetails = {
  /** The opaque Place id. Stable enough to store; not a secret. */
  readonly placeId: string;
  readonly name: string;
  readonly formattedAddress: string | null;
  readonly location: PlaceCoordinates | null;
  readonly rating: number | null;
  readonly userRatingCount: number | null;
  readonly websiteUri: string | null;
  readonly phone: string | null;
  /** Human-readable opening lines, one per weekday, as Google renders them. */
  readonly weekdayDescriptions: readonly string[];
  /** Place resource names for photos, not URLs -- fetching one needs the key. */
  readonly photoNames: readonly string[];
  readonly types: readonly string[];
};

/**
 * Place types Google uses for somewhere a guest sleeps.
 *
 * Checked rather than assumed: a tenant that pastes the Place id of the café
 * next door would otherwise onboard a hotel whose lobby screen shows a café's
 * hours, and nothing downstream would notice.
 */
const LODGING_TYPES: ReadonlySet<string> = new Set([
  'lodging', 'hotel', 'motel', 'resort_hotel', 'extended_stay_hotel',
  'bed_and_breakfast', 'guest_house', 'hostel', 'inn', 'cottage', 'farmstay',
]);

export function isLodging(place: Pick<PlaceDetails, 'types'>): boolean {
  return place.types.some((type) => LODGING_TYPES.has(type));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** A finite number, or null. Rejects NaN, which `typeof` calls a number. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function coordinates(value: unknown): PlaceCoordinates | null {
  if (!isRecord(value)) return null;
  const lat = finite(value.latitude);
  const lng = finite(value.longitude);
  // A partial coordinate is worse than none: it would place a property on the
  // equator or the prime meridian rather than admit it does not know.
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((entry): entry is string => entry !== null);
}

function photoNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((photo) => (isRecord(photo) ? text(photo.name) : null))
    .filter((name): name is string => name !== null);
}

/**
 * Normalizes one Places API `Place` into the shape above.
 *
 * Total: every field is optional in the response, and a missing one becomes
 * null rather than throwing, because a hotel with no published phone number is
 * an ordinary hotel and not a failed lookup. Only a missing id is fatal -- with
 * no id there is nothing to store the result against.
 */
export function normalizePlace(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw)) return null;
  const placeId = text(raw.id);
  if (placeId === null) return null;
  const displayName = isRecord(raw.displayName) ? text(raw.displayName.text) : null;
  const hours = isRecord(raw.regularOpeningHours) ? raw.regularOpeningHours : null;
  return {
    placeId,
    name: displayName ?? placeId,
    formattedAddress: text(raw.formattedAddress),
    location: coordinates(raw.location),
    rating: finite(raw.rating),
    userRatingCount: finite(raw.userRatingCount),
    websiteUri: text(raw.websiteUri),
    phone: text(raw.internationalPhoneNumber) ?? text(raw.nationalPhoneNumber),
    weekdayDescriptions: strings(hours?.weekdayDescriptions),
    photoNames: photoNames(raw.photos),
    types: strings(raw.types),
  };
}

/** The field mask the client sends. Derived from the type, never hand-listed. */
export const PLACE_FIELDS: readonly string[] = [
  'id', 'displayName', 'formattedAddress', 'location', 'rating',
  'userRatingCount', 'websiteUri', 'internationalPhoneNumber',
  'nationalPhoneNumber', 'regularOpeningHours.weekdayDescriptions',
  'photos.name', 'types',
];
