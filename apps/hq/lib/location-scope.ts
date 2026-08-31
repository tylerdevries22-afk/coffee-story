/**
 * Narrowing brand-wide rows to the one location the operator has scoped the
 * console to. RLS already isolates the brand; this is the within-brand focus
 * the header location switcher promises, applied identically to live rows and
 * demo fixtures so the two paths cannot drift. A null scope means "all
 * locations" and returns the rows untouched.
 */
export function scopeRowsToLocation<T extends { locationId: string }>(
  rows: readonly T[],
  locationId: string | null,
): T[] {
  return locationId ? rows.filter((row) => row.locationId === locationId) : [...rows];
}
