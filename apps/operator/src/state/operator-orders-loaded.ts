/**
 * Whether the order board already knows the true state of `orders`.
 *
 * Local demo fixtures are synchronous, so a plain demo starts loaded. A
 * shared demo channel or a live tenant starts every column empty and waits
 * on a network round trip, so a cold column must not be read as a confirmed
 * empty board until the first fetch or realtime snapshot lands -- that
 * false-empty read is exactly what sent a barista looking for orders that
 * were only still loading.
 */
export function initialOrdersLoaded(brokered: boolean, live: boolean): boolean {
  return !(brokered || live);
}

/** What an empty column says: genuinely empty only once `ordersLoaded` is
 * true, otherwise still loading. */
export function columnEmptyLabel(ordersLoaded: boolean): string {
  return ordersLoaded ? 'Nothing here.' : 'Loading orders…';
}
