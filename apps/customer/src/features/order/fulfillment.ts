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
 * 'dispatch' vocabulary inherited from the appointment app this tree was
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

export const PICKUP_LOCATIONS: readonly PickupLocation[] = [
  {
    id: 'coffee-story-havana',
    name: 'Coffee Story — Havana St',
    address: '2222 S Havana St Unit A1',
    cityLine: 'Aurora, CO 80014',
    // Must agree with SHOP_HOURS in features/order/pickup.ts. It said
    // "Open daily 8am-11pm", which on a Friday at 11:30pm sat next to a
    // computed "Now brewing" badge -- one card contradicting itself.
    note: 'Sun–Thu to 11pm, Fri–Sat to midnight · free parking',
  },
] as const;

export const EMPTY_DELIVERY_ADDRESS: DeliveryAddress = {
  street: '',
  unit: '',
  city: '',
  state: 'CO',
  postalCode: '',
  instructions: '',
};

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
