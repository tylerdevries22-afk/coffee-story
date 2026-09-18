/**
 * The subset of a Google Place this platform stores or draws.
 *
 * Deliberately narrow. A location record, a lobby screen and a demo need a
 * business's identity, where it is, how to reach it, when it is open and where
 * its reviews live; nothing here carries a review body, a reviewer's name, or
 * anything else that would make this a copy of someone else's content rather
 * than a pointer at it. The field mask is derived from this type, so the
 * request cannot quietly widen.
 */
import {
  address, businessStatus, coordinates, finite, httpsUri, isRecord, openingPeriods,
  photoNames, strings, text, timeZoneId,
  type PlaceAddress, type PlaceBusinessStatus, type PlaceCoordinates, type PlaceOpeningPeriod,
} from './places-fields';

export type { PlaceAddress, PlaceBusinessStatus, PlaceCoordinates, PlaceOpeningPeriod } from './places-fields';

export type PlaceDetails = {
  /** The opaque Place id. Stable enough to store; not a secret. */
  readonly placeId: string;
  readonly name: string;
  readonly formattedAddress: string | null;
  readonly address: PlaceAddress;
  readonly location: PlaceCoordinates | null;
  /** IANA zone, e.g. `America/Denver`, so hours need no second lookup. */
  readonly timeZone: string | null;
  readonly rating: number | null;
  readonly userRatingCount: number | null;
  readonly websiteUri: string | null;
  readonly phone: string | null;
  /** Human-readable opening lines, one per weekday, as Google renders them. */
  readonly weekdayDescriptions: readonly string[];
  /** The same hours as data, which is what a form can be filled from. */
  readonly openingPeriods: readonly PlaceOpeningPeriod[];
  /** Place resource names for photos, not URLs -- fetching one needs the key. */
  readonly photoNames: readonly string[];
  readonly types: readonly string[];
  /** The one type Google leads with, e.g. `coffee_shop`; drives industry. */
  readonly primaryType: string | null;
  /** A closed business is not worth a demo; this is how a batch knows. */
  readonly businessStatus: PlaceBusinessStatus | null;
  readonly mapsUri: string | null;
  readonly reviewsUri: string | null;
  readonly writeReviewUri: string | null;
};

/**
 * Where each field comes from in the response. `satisfies` makes a field
 * added to `PlaceDetails` without a source a type error, and the mask below is
 * built from this table, so the request and the type cannot drift apart.
 *
 * Billing is by the costliest field requested. `websiteUri`, the phone
 * numbers and `regularOpeningHours` are already Enterprise, so everything else
 * here rides along at no extra cost; adding anything from the Atmosphere tier
 * would not.
 */
export const PLACE_FIELD_SOURCES = {
  placeId: ['id'],
  name: ['displayName'],
  formattedAddress: ['formattedAddress'],
  address: ['addressComponents'],
  location: ['location'],
  timeZone: ['timeZone'],
  rating: ['rating'],
  userRatingCount: ['userRatingCount'],
  websiteUri: ['websiteUri'],
  phone: ['internationalPhoneNumber', 'nationalPhoneNumber'],
  weekdayDescriptions: ['regularOpeningHours.weekdayDescriptions'],
  openingPeriods: ['regularOpeningHours.periods'],
  photoNames: ['photos.name'],
  types: ['types'],
  primaryType: ['primaryType'],
  businessStatus: ['businessStatus'],
  mapsUri: ['googleMapsUri'],
  reviewsUri: ['googleMapsLinks.reviewsUri'],
  writeReviewUri: ['googleMapsLinks.writeAReviewUri'],
} as const satisfies Record<keyof PlaceDetails, readonly string[]>;

/** The field mask the client sends. Derived from the type, never hand-listed. */
export const PLACE_FIELDS: readonly string[] = Object.values(PLACE_FIELD_SOURCES).flat();

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

/**
 * Normalizes one Places API `Place` into the shape above.
 *
 * Total: every field is optional in the response, and a missing one becomes
 * null rather than throwing, because a business with no published phone
 * number is an ordinary business and not a failed lookup. Only a missing id is
 * fatal -- with no id there is nothing to store the result against.
 */
export function normalizePlace(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw)) return null;
  const placeId = text(raw.id);
  if (placeId === null) return null;
  const displayName = isRecord(raw.displayName) ? text(raw.displayName.text) : null;
  const hours = isRecord(raw.regularOpeningHours) ? raw.regularOpeningHours : null;
  const links = isRecord(raw.googleMapsLinks) ? raw.googleMapsLinks : null;
  return {
    placeId,
    name: displayName ?? placeId,
    formattedAddress: text(raw.formattedAddress),
    address: address(raw.addressComponents),
    location: coordinates(raw.location),
    timeZone: timeZoneId(raw.timeZone),
    rating: finite(raw.rating),
    userRatingCount: finite(raw.userRatingCount),
    websiteUri: text(raw.websiteUri),
    phone: text(raw.internationalPhoneNumber) ?? text(raw.nationalPhoneNumber),
    weekdayDescriptions: strings(hours?.weekdayDescriptions),
    openingPeriods: openingPeriods(hours?.periods),
    photoNames: photoNames(raw.photos),
    types: strings(raw.types),
    primaryType: text(raw.primaryType),
    businessStatus: businessStatus(raw.businessStatus),
    mapsUri: httpsUri(raw.googleMapsUri),
    reviewsUri: httpsUri(links?.reviewsUri),
    writeReviewUri: httpsUri(links?.writeAReviewUri),
  };
}
