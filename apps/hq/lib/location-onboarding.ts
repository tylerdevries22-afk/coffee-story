export type LocationCreationContinuation =
  | { kind: 'connect'; href: string }
  | { kind: 'created'; notice: '1' | 'square_deferred' };

/** Keeps Square consent on the JWT's home tenant until audited support exists. */
export function locationCreationContinuation(input: {
  locationId: string;
  homeOrganizationId: string;
  selectedOrganizationId: string;
  connectSquare: boolean;
}): LocationCreationContinuation {
  if (!input.connectSquare) return { kind: 'created', notice: '1' };
  if (input.selectedOrganizationId !== input.homeOrganizationId) {
    return { kind: 'created', notice: 'square_deferred' };
  }
  return {
    kind: 'connect',
    href: `/api/square/connect?location_id=${encodeURIComponent(input.locationId)}`,
  };
}
