/**
 * The identity and contact fields a location can carry beyond its address:
 * the Google Place it is, where it sits, a phone number and a website.
 *
 * Every one is optional -- a location typed by hand has none of them -- and
 * every one is refused rather than dropped when it is present and malformed.
 * The Place id and coordinates arrive in hidden fields the wizard filled from
 * Google, so a malformed one is a bug to surface, not a value to guess at.
 *
 * Pure and asset-free: the wizard runs these in the browser before it submits,
 * and the server runs them again on what actually arrived.
 */
import { isSafePublicHttpsUrl } from './content-guards';

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** The engine's Place id shape, which the `locations.google_place_id` check also enforces. */
const PLACE_ID = /^[A-Za-z0-9_-]{6,255}$/;
const PHONE = /^\+?[0-9 ().-]+$/;
const WEBSITE_MAX = 2_048;
export const WEBSITE_ERROR = 'Enter the website as a public https:// address.';

function clean(value: string | undefined | null): string {
  return (value ?? '').trim();
}

export function placeIdOf(raw: string | undefined): Checked<string | null> {
  const value = clean(raw);
  if (!value) return { ok: true, value: null };
  return PLACE_ID.test(value)
    ? { ok: true, value }
    : { ok: false, error: 'The Google listing reference is not valid. Search for the business again.' };
}

/**
 * A number a person can dial: digits with the punctuation phone numbers are
 * written with, and 7 to 15 digits -- the most E.164 allows.
 */
export function phoneOf(raw: string | undefined | null): Checked<string | null> {
  const value = clean(raw);
  if (!value) return { ok: true, value: null };
  const digits = value.replace(/\D/g, '').length;
  return value.length <= 32 && PHONE.test(value) && digits >= 7 && digits <= 15
    ? { ok: true, value }
    : { ok: false, error: 'Enter a phone number with 7 to 15 digits.' };
}

function coordinate(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  // Number('') is 0, which is why the empty case returns above: an unset
  // field must not place a location on the equator.
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Both or neither: half a coordinate is worse than none. */
export function coordinatesOf(lat: unknown, lng: unknown): Checked<{ lat: number; lng: number } | null> {
  const [latitude, longitude] = [coordinate(lat), coordinate(lng)];
  if (latitude === undefined && longitude === undefined) return { ok: true, value: null };
  if (latitude == null || longitude == null
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { ok: false, error: 'The map position is not valid. Search for the business again.' };
  }
  return { ok: true, value: { lat: latitude, lng: longitude } };
}

/**
 * A website someone typed: a public https address, or nothing.
 *
 * https only, because the factory's `platform_onboarding_runs.website_url`
 * accepts nothing else and its research step fetches whatever is stored there;
 * public only, for the same reason -- a server-side fetch of a private address
 * is a request into the deployment's own network.
 */
export function websiteFromInput(raw: string | undefined): Checked<string | null> {
  const value = clean(raw);
  if (!value) return { ok: true, value: null };
  return value.length <= WEBSITE_MAX && isSafePublicHttpsUrl(value)
    ? { ok: true, value }
    : { ok: false, error: WEBSITE_ERROR };
}

export type GoogleWebsite = {
  readonly value: string | null;
  /** What was changed on the way in, so the wizard can say so. */
  readonly note: 'upgraded' | 'dropped' | null;
};

/**
 * The website a Google listing names, made acceptable to the factory.
 *
 * A listing's owner types this, and plenty still say `http://`. Dropping
 * those would send the research step to a business with no site at all;
 * keeping them would fail the https check the run row enforces. So an http
 * address is moved to https -- the same host and path, which nearly every
 * site now serves -- and flagged, so the operator checks it loads before the
 * factory relies on it. Anything that is not a public web address is left out
 * and flagged too.
 */
export function websiteFromGoogle(uri: string | null): GoogleWebsite {
  const value = clean(uri);
  if (!value) return { value: null, note: null };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { value: null, note: 'dropped' };
  }
  const upgraded = url.protocol === 'http:';
  if (upgraded) url.protocol = 'https:';
  const candidate = url.toString();
  if (candidate.length > WEBSITE_MAX || !isSafePublicHttpsUrl(candidate)) {
    return { value: null, note: 'dropped' };
  }
  return { value: candidate, note: upgraded ? 'upgraded' : null };
}
