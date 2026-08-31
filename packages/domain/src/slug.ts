/**
 * A key-safe form of a human name.
 *
 * Six near-identical copies of this had accumulated -- two in this package,
 * one in the schema, one in each of two apps, one in HQ -- agreeing on the
 * shape they produce and disagreeing at every edge: caps of 64, 72, 80 and
 * none, and two spellings of the trailing-dash trim. The disagreement matters
 * because these ids have to round-trip. `apps/customer` derives a category id
 * capped at 72 and matches it against one `packages/schema` seeded with no cap
 * at all, so a category title longer than that produced two ids for one
 * category and a section the guest could not open.
 *
 * The cap is applied before the final trim, not after. Every copy sliced last,
 * which meant a name whose cut landed on a separator produced a trailing dash
 * -- an id that looks like a typo and sorts like one.
 *
 * `packages/schema` keeps its own copy: this package depends on that one, so
 * the import cannot run the other way.
 */
export function slugify(value: string, maxLength = 72): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}
