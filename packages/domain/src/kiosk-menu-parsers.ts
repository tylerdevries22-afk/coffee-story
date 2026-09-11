import type { OptionGroup } from './menu-options';
import type { CatalogSize } from './sizes';

function finiteCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

/**
 * Sizes, from either spelling.
 *
 * An item with no sizes is normal -- the seed's pastry carries `sizes: []` --
 * and a screen with no size to price is a dead end, so one size is synthesised
 * from `base_price_cents`. Entries with no usable price are dropped rather
 * than shown at zero: a kiosk that sells something for nothing is worse than
 * a kiosk missing a row.
 */
export function parseSizes(raw: unknown, basePriceCents: number): CatalogSize[] {
  const base = finiteCents(basePriceCents) ?? 0;
  const rows = Array.isArray(raw) ? raw : [];
  const sizes: CatalogSize[] = [];
  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    if (slug === '') continue;
    const priceCents = finiteCents(record.priceCents) ?? finiteCents(record.price_cents);
    if (priceCents === null) continue;
    const label = typeof record.label === 'string' && record.label.trim() !== ''
      ? record.label.trim()
      : undefined;
    // Ounces are not stored. A bare numeric slug is the volume, which is what
    // the seed writes and what the label reads back as.
    const numeric = /^(\d+)$/.exec(slug);
    const ounces = finiteCents(record.ounces) ?? (numeric ? Number(numeric[1]) : null);
    sizes.push({
      slug,
      priceCents,
      ...(ounces !== null ? { ounces } : {}),
      ...(label ? { label } : {}),
    });
  }
  if (sizes.length > 0) return sizes;
  return base > 0 ? [{ slug: 'each', priceCents: base, synthetic: true }] : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Reads the exact JSONB option-group contract used by server-side pricing.
 *
 * `null` means the row is malformed, while `[]` is a valid item with no
 * customizations. Keeping those cases distinct lets the live mapper omit an
 * unsafe item instead of silently selling it without a required modifier.
 */
export function parseOptionGroups(raw: unknown): OptionGroup[] | null {
  if (!Array.isArray(raw)) return null;

  const groups: OptionGroup[] = [];
  const groupIds = new Set<string>();
  const choiceIds = new Set<string>();
  for (const entry of raw) {
    const source = record(entry);
    if (!source || !nonEmpty(source.id) || !nonEmpty(source.name)
      || (source.select !== 'single' && source.select !== 'multi')
      || typeof source.required !== 'boolean'
      || !Number.isInteger(source.maxChoices) || Number(source.maxChoices) < 1
      || (source.select === 'single' && source.maxChoices !== 1)
      || !Array.isArray(source.choices) || source.choices.length === 0
      || groupIds.has(source.id)) return null;

    const choices: OptionGroup['choices'][number][] = [];
    for (const entryChoice of source.choices) {
      const choice = record(entryChoice);
      if (!choice || !nonEmpty(choice.id) || !nonEmpty(choice.name)
        || !Number.isInteger(choice.priceDeltaCents) || Number(choice.priceDeltaCents) < 0
        || choiceIds.has(choice.id)) return null;
      choiceIds.add(choice.id);
      choices.push({
        id: choice.id,
        name: choice.name,
        priceDeltaCents: Number(choice.priceDeltaCents),
      });
    }

    groupIds.add(source.id);
    const dependency = source.dependsOn === undefined
      ? undefined
      : parseOptionDependency(source.dependsOn);
    if (source.dependsOn !== undefined && dependency === null) return null;
    groups.push({
      id: source.id,
      name: source.name,
      select: source.select,
      required: source.required,
      maxChoices: Number(source.maxChoices),
      choices,
      ...(dependency ? { dependsOn: dependency } : {}),
    });
  }

  for (const group of groups) {
    const dependency = group.dependsOn;
    if (!dependency) continue;
    const parent = groups.find((candidate) => candidate.id === dependency.groupId);
    if (!parent || parent.id === group.id
      || dependency.choiceIds.some((choiceId) => (
        !parent.choices.some((choice) => choice.id === choiceId)
      ))) return null;
  }
  return groups;
}

function parseOptionDependency(value: unknown): OptionGroup['dependsOn'] | null {
  const source = record(value);
  if (!source || !nonEmpty(source.groupId) || !Array.isArray(source.choiceIds)
    || source.choiceIds.length === 0 || source.choiceIds.some((id) => !nonEmpty(id))) return null;
  return { groupId: source.groupId, choiceIds: source.choiceIds as string[] };
}
