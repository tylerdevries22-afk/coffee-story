/**
 * The first location as the provisioning RPC reads it: its `p_location`.
 *
 * Written out once, from the parsed draft, so the server action sends the
 * function's contract rather than whatever the draft happens to hold. That is
 * the name, the address (street, city, region, postal, and the map pin as
 * `lat`/`lng`, where the column's documented shape keeps it), the hours, the
 * time zone, and what the Places wizard collects: the Google Place id, phone
 * and website. Each of those three is null when the operator gave none;
 * 20260918140000 treats null and an absent key alike, stores the rest, and
 * refuses anything malformed with `invalid_first_location`.
 *
 * What stays behind is display-only: the hours summary and the copied city.
 * Every value here already passed location-input.ts; the database checks the
 * same rules again, because the RPC is callable without this console.
 */
import type { HoursByDay } from './location-hours';
import type { LocationAddress, LocationDraft } from './location-input';

export type ProvisioningLocation = {
  readonly name: string;
  readonly address: LocationAddress;
  readonly hours: HoursByDay;
  readonly timezone: string;
  readonly googlePlaceId: string | null;
  readonly phone: string | null;
  readonly website: string | null;
};

export function provisioningLocation(location: LocationDraft | null): ProvisioningLocation | null {
  if (!location) return null;
  return {
    name: location.name,
    address: location.address,
    hours: location.hours,
    timezone: location.timezone,
    googlePlaceId: location.googlePlaceId,
    phone: location.phone,
    website: location.website,
  };
}
