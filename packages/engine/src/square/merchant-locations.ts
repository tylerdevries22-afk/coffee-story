import { call, PLATFORM_CURRENCY, type SquareConfig } from './transport';

/** One of the merchant's own Square locations, as `/v2/locations` reports it. */
export type SquareMerchantLocation = {
  id: string;
  name?: string;
  status?: string;
  currency?: string;
};

/**
 * The merchant's Square locations. `MERCHANT_PROFILE_READ` is requested at
 * consent for this call and nothing else.
 */
export async function listSquareLocations(
  config: SquareConfig,
  token: string,
): Promise<SquareMerchantLocation[]> {
  const body = await call<{ locations?: SquareMerchantLocation[] }>(config, '/v2/locations', {
    method: 'GET',
    token,
  });
  return body.locations ?? [];
}

export type SquareLocationRefusal = 'no_active_location' | 'unsupported_currency' | 'several_locations';

export type SquareLocationChoice =
  | { ok: true; location: SquareMerchantLocation }
  | { ok: false; reason: SquareLocationRefusal };

/**
 * Which of a merchant's Square locations a shop bills against.
 *
 * Only an unambiguous answer counts. Binding the wrong one sends a shop's
 * takings to a sibling store's books, and no heuristic over names or addresses
 * is worth that: several candidates is a question for the owner, not a guess.
 * Refusing is safe, because nothing is written until this says yes.
 *
 * A missing `status` or `currency` is read generously -- Square sends both, and
 * refusing a whole merchant over a field that did not arrive would be a worse
 * failure than the one this guards against.
 */
export function chooseSquareLocation(
  locations: readonly SquareMerchantLocation[],
): SquareLocationChoice {
  const active = locations.filter((location) => location.id && (location.status ?? 'ACTIVE') === 'ACTIVE');
  if (active.length === 0) return { ok: false, reason: 'no_active_location' };
  // A merchant who settles in another currency cannot be served by this
  // platform at all (see PLATFORM_CURRENCY), and the honest place to say so is
  // here, once, rather than as a rejected payment at a guest's first checkout.
  const payable = active.filter((location) => (location.currency ?? PLATFORM_CURRENCY) === PLATFORM_CURRENCY);
  if (payable.length === 0) return { ok: false, reason: 'unsupported_currency' };
  if (payable.length > 1) return { ok: false, reason: 'several_locations' };
  const [only] = payable;
  if (!only) return { ok: false, reason: 'no_active_location' };
  return { ok: true, location: only };
}

