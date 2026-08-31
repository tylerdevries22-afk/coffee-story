export type LocationCreationContinuation =
  { kind: 'onboard'; href: string; squareHref: string | null; squareDeferred: boolean };

/** Keeps one-time pairing output in action state and Square consent on the home tenant. */
export function locationCreationContinuation(input: {
  locationId: string;
  homeOrganizationId: string;
  selectedOrganizationId: string;
  connectSquare: boolean;
}): LocationCreationContinuation {
  const squareAllowed = input.connectSquare
    && input.selectedOrganizationId === input.homeOrganizationId;
  const params = new URLSearchParams({ created: input.locationId });
  if (squareAllowed) params.set('square', '1');
  if (input.connectSquare && !squareAllowed) params.set('square', 'deferred');
  return {
    kind: 'onboard',
    href: `/locations/new?${params.toString()}`,
    squareHref: squareAllowed
      ? `/api/square/connect?location_id=${encodeURIComponent(input.locationId)}`
      : null,
    squareDeferred: input.connectSquare && !squareAllowed,
  };
}
