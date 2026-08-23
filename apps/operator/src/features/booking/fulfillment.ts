import { currentBusiness } from '@/data/business';

export type VisitMode = 'office' | 'dispatch';

export type OfficeLocation = {
  id: string;
  name: string;
  address: string;
  cityLine: string;
  note: string;
};

export type DispatchAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postalCode: string;
  instructions: string;
};

export type BookingFulfillment =
  | { mode: 'office'; office: OfficeLocation }
  | { mode: 'dispatch'; address: DispatchAddress };

/**
 * The shop you collect from, which is the tenant's own -- it was spelled out
 * here as "Coffee Story — Havana St, 2222 S Havana St, Aurora CO", so every
 * other brand's guests were sent to a coffee shop in Colorado.
 *
 * A getter rather than a const: `currentBusiness()` is fixed for the lifetime
 * of a guest binary but resolves per signed-in brand in the staff app, and a
 * module-level array would freeze whichever answer came first.
 */
export function officeLocations(): readonly OfficeLocation[] {
  const business = currentBusiness();
  return [
    {
      id: 'pickup-primary',
      name: business.name,
      address: business.street,
      cityLine: business.cityLine,
      // Must agree with SHOP_HOURS in features/order/pickup.ts. It said
      // "Open daily 8am-11pm", which on a Friday at 11:30pm sat next to a
      // computed "Now brewing" badge -- one card contradicting itself.
      note: 'Sun–Thu to 11pm, Fri–Sat to midnight · free parking',
    },
  ];
}

export const EMPTY_DISPATCH_ADDRESS: DispatchAddress = {
  street: '',
  unit: '',
  city: '',
  state: 'CO',
  postalCode: '',
  instructions: '',
};

export function validateDispatchAddress(address: DispatchAddress): string | null {
  if (address.street.trim().length < 4) return 'Enter the street address for the delivery.';
  if (address.city.trim().length < 2) return 'Enter the city for the delivery.';
  if (!/^[A-Za-z]{2}$/.test(address.state.trim())) return 'Use a two-letter state abbreviation.';
  if (!/^\d{5}(?:-\d{4})?$/.test(address.postalCode.trim())) return 'Enter a valid ZIP code.';
  return null;
}

export function dispatchAddressLine(address: DispatchAddress): string {
  const unit = address.unit.trim() ? `, ${address.unit.trim()}` : '';
  return `${address.street.trim()}${unit}, ${address.city.trim()}, ${address.state.trim().toUpperCase()} ${address.postalCode.trim()}`;
}

export function fulfillmentLabel(fulfillment: BookingFulfillment): string {
  // "Mobile visit" was the massage business's word for a therapist travelling
  // to a client. The order flow prints this on the menu pill, in the bag, and
  // into the placed order's `locationLabel`.
  return fulfillment.mode === 'office'
    ? fulfillment.office.name
    : 'Delivery';
}

export function fulfillmentDetail(fulfillment: BookingFulfillment): string {
  return fulfillment.mode === 'office'
    ? `${fulfillment.office.address}, ${fulfillment.office.cityLine}`
    : dispatchAddressLine(fulfillment.address);
}
