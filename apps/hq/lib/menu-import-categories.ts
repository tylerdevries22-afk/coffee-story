import { slugify } from '@platform/domain';

export type ExistingImportCategory = Readonly<{
  id: string;
  title: string;
  slug: string;
}>;

export type NewImportCategory = Readonly<{
  title: string;
  slug: string;
  sortOrder: number;
}>;

function availableSlug(title: string, used: Set<string>): string {
  const base = slugify(title, 58) || 'category';
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix <= 999_999; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('category_slug_space_exhausted');
}

/** Plan only missing categories while preserving every persisted identity. */
export function planImportCategories(
  titles: readonly string[],
  existing: readonly ExistingImportCategory[],
): NewImportCategory[] {
  const knownTitles = new Set(existing.map((category) => category.title));
  const usedSlugs = new Set(existing.map((category) => category.slug));
  const planned: NewImportCategory[] = [];

  for (const title of new Set(titles)) {
    if (knownTitles.has(title)) continue;
    const slug = availableSlug(title, usedSlugs);
    usedSlugs.add(slug);
    knownTitles.add(title);
    planned.push({ title, slug, sortOrder: existing.length + planned.length });
  }
  return planned;
}
