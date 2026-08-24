/**
 * Where an order was taken.
 *
 * Derived from who is calling, never from the request body: a client that could
 * name its own channel could dress a web order up as in-app and flatter the
 * brand's own dashboard. That much was already true. What was not is that the
 * derivation lived as a ternary inside one route and could not produce
 * `'kiosk'` at all --
 *
 *     channel: auth.claims.role ? 'pos' : 'app'
 *
 * -- so every self-service sale was recorded as an in-app one. That is not a
 * cosmetic error: `location_daily_metrics.in_app_share` filters on
 * `channel in ('app','web')`, and it is the headline number in the HQ
 * dashboard and the owner's weekly email. With kiosk sales landing in the
 * denominator and never the numerator, the metric an owner reads as "how much
 * is coming through our own platform" FALLS as more guests use the platform's
 * own hardware.
 *
 * Pure and tested, so the rule is checkable rather than incidental.
 */
import type { DeviceRole, OrderChannel } from '@platform/schema';

/** What the caller is, as far as attribution is concerned. */
export type OrderPrincipal = {
  /**
   * The paired device's role, when a device token made the call. A device
   * carries no staff role by design, so this is the only thing that can
   * distinguish a lobby kiosk from a guest's phone.
   */
  deviceRole?: DeviceRole | null;
  /** A staff role from a user token, when a person made the call. */
  staffRole?: string | null;
};

export function resolveOrderChannel(principal: OrderPrincipal): OrderChannel {
  const device = principal.deviceRole;
  if (device === 'kiosk') return 'kiosk';
  if (device === 'pos') return 'pos';
  // A display or a prep tablet must never be able to place an order at all;
  // the caller rejects them before this, and falling through to 'app' here
  // would silently attribute one if that check were ever removed.
  if (device) return 'app';
  // A staff token is someone at the counter taking an order for a guest.
  return principal.staffRole ? 'pos' : 'app';
}

/** Channels that `in_app_share` counts as the brand's own platform. */
export const IN_APP_CHANNELS: readonly OrderChannel[] = ['app', 'web'];

/**
 * Whether a channel is the brand's own platform rather than a third party.
 *
 * A kiosk IS the brand's own platform -- arguably the most owned channel there
 * is -- so any share metric that excludes it is measuring something other than
 * what its name says. Exported so the view and the report can be reconciled
 * against one definition instead of a SQL literal.
 */
export function isOwnedChannel(channel: OrderChannel): boolean {
  return channel === 'app' || channel === 'web' || channel === 'kiosk';
}
