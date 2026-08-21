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

export const OFFICE_LOCATIONS: readonly OfficeLocation[] = [
  {
    id: 'greenwood-village',
    name: 'Greenwood Village',
    address: '5650 Greenwood Plaza Blvd, Suite 225-C',
    cityLine: 'Greenwood Village, CO 80111',
    note: 'Primary studio · easy parking',
  },
  {
    id: 'boulder',
    name: 'Boulder',
    address: '1750 Pearl Street, Suite 200',
    cityLine: 'Boulder, CO 80302',
    note: 'Select appointment days',
  },
] as const;

export const EMPTY_DISPATCH_ADDRESS: DispatchAddress = {
  street: '',
  unit: '',
  city: '',
  state: 'CO',
  postalCode: '',
  instructions: '',
};

export function validateDispatchAddress(address: DispatchAddress): string | null {
  if (address.street.trim().length < 4) return 'Enter the street address for the visit.';
  if (address.city.trim().length < 2) return 'Enter the city for the visit.';
  if (!/^[A-Za-z]{2}$/.test(address.state.trim())) return 'Use a two-letter state abbreviation.';
  if (!/^\d{5}(?:-\d{4})?$/.test(address.postalCode.trim())) return 'Enter a valid ZIP code.';
  return null;
}

export function dispatchAddressLine(address: DispatchAddress): string {
  const unit = address.unit.trim() ? `, ${address.unit.trim()}` : '';
  return `${address.street.trim()}${unit}, ${address.city.trim()}, ${address.state.trim().toUpperCase()} ${address.postalCode.trim()}`;
}

export function fulfillmentLabel(fulfillment: BookingFulfillment): string {
  return fulfillment.mode === 'office'
    ? fulfillment.office.name
    : 'Mobile visit';
}

export function fulfillmentDetail(fulfillment: BookingFulfillment): string {
  return fulfillment.mode === 'office'
    ? `${fulfillment.office.address}, ${fulfillment.office.cityLine}`
    : dispatchAddressLine(fulfillment.address);
}
