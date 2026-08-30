/**
 * How an order reaches the guest.
 *
 * The mode strings are deliberately the same literals `packages/schema` uses
 * for `app.fulfillment_type` ('pickup' | 'curbside' | 'catering' | 'delivery'),
 * so a cart can be handed to the engine without a translation layer. The app
 * offers two of the four today; the other two are brand feature flags
 * (`catering`, `delivery`) and slot in here without renaming anything.
 *
 * This module previously lived under features/booking with an 'office' |
 * 'dispatch' vocabulary inherited from the order app this tree was
 * forked from. The content was already coffee; only the names were not.
 */
export type FulfillmentMode = 'pickup' | 'delivery';

export type PickupLocation = {
  id: string;
  name: string;
  address: string;
  cityLine: string;
  note: string;
};

export type DeliveryAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postalCode: string;
  instructions: string;
};

export type OrderFulfillment =
  | { mode: 'pickup'; location: PickupLocation }
  | { mode: 'delivery'; address: DeliveryAddress };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "Aurora, CO 80014" from whichever of the three parts the tenant supplied. */
function cityLineOf(address: Record<string, unknown> | null): string {
  if (!address) return '';
  const city = text(address.city);
  const region = text(address.region);
  const postal = text(address.postal);
  const head = [city, region].filter(Boolean).join(', ');
  return [head, postal].filter(Boolean).join(' ');
}

/** A stable id for a location the tenant did not give one, from its name. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function pickupLocationOf(
  entry: Record<string, unknown>,
  fallbackName: string,
  index: number,
): PickupLocation | null {
  const address = record(entry.address);
  const name = text(entry.name) || fallbackName;
  const street = text(address?.street);
  const cityLine = cityLineOf(address);
  // A card with a name and nothing to walk to is worse than no card: a guest
  // taps it, and the order is placed against an address the shop never gave.
  if (!name || (!street && !cityLine)) return null;
  return {
    id: text(entry.id) || slug(name) || `location-${index + 1}`,
    name,
    address: street,
    cityLine,
    note: text(entry.note),
  };
}

/**
 * The shops a guest may collect from, read from the tenant config.
 *
 * This was a frozen array holding one brand's street address, which every
 * tenant built on this engine would have shipped. It is now derived: a single
 * `location`, or a `locations` array once `multi_location` is on.
 *
 * The note stays whatever the tenant wrote -- "Free parking", "Enter from the
 * alley". It deliberately does not restate opening hours: the old constant did,
 * had to be kept in step with a separate table by hand, and the comment saying
 * so was the only thing holding the two together.
 */
export function resolvePickupLocations(config: unknown): readonly PickupLocation[] {
  const source = record(config);
  if (!source) return [];
  const fallbackName = text(record(source.identity)?.name);
  const listed = Array.isArray(source.locations)
    ? source.locations
    : [source.location];
  const locations: PickupLocation[] = [];
  listed.forEach((entry, index) => {
    const resolved = record(entry);
    if (!resolved) return;
    const location = pickupLocationOf(resolved, fallbackName, index);
    if (location) locations.push(location);
  });
  return locations;
}

/**
 * A blank delivery address, pre-filled with the state the shop is in.
 *
 * Only the state, and only because a guest ordering delivery is almost always
 * in the same one -- guessing a city or a ZIP would put a wrong address in
 * front of someone who then confirms it without reading.
 */
export function emptyDeliveryAddress(config: unknown): DeliveryAddress {
  const location = record(record(config)?.location);
  const region = text(record(location?.address)?.region);
  return {
    street: '',
    unit: '',
    city: '',
    state: /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : '',
    postalCode: '',
    instructions: '',
  };
}

export function validateDeliveryAddress(address: DeliveryAddress): string | null {
  if (address.street.trim().length < 4) return 'Enter the street address for the delivery.';
  if (address.city.trim().length < 2) return 'Enter the city for the delivery.';
  if (!/^[A-Za-z]{2}$/.test(address.state.trim())) return 'Use a two-letter state abbreviation.';
  if (!/^\d{5}(?:-\d{4})?$/.test(address.postalCode.trim())) return 'Enter a valid ZIP code.';
  return null;
}

export function deliveryAddressLine(address: DeliveryAddress): string {
  const unit = address.unit.trim() ? `, ${address.unit.trim()}` : '';
  return `${address.street.trim()}${unit}, ${address.city.trim()}, ${address.state.trim().toUpperCase()} ${address.postalCode.trim()}`;
}

export function fulfillmentLabel(fulfillment: OrderFulfillment): string {
  // Printed on the menu pill, in the bag, and into the placed order's
  // `locationLabel`.
  return fulfillment.mode === 'pickup' ? fulfillment.location.name : 'Delivery';
}

export function fulfillmentDetail(fulfillment: OrderFulfillment): string {
  return fulfillment.mode === 'pickup'
    ? `${fulfillment.location.address}, ${fulfillment.location.cityLine}`
    : deliveryAddressLine(fulfillment.address);
}
