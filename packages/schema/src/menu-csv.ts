/**
 * The tenants/<slug>/menu.csv contract the onboarding seed reads.
 *
 * Columns: slug,name,category,description,base_price_cents,sizes
 * - base_price_cents: integer cents (never dollars)
 * - sizes: optional "12:450|16:525" -> [{slug,label,price_cents}]
 * Quoted fields follow RFC 4180 (menus contain commas).
 */

export type MenuCsvRow = {
  slug: string;
  name: string;
  category: string;
  description: string;
  basePriceCents: number;
  sizes: { slug: string; label: string; price_cents: number }[];
};

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseMenuCsv(content: string): { rows: MenuCsvRow[]; errors: string[] } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const errors: string[] = [];
  const rows: MenuCsvRow[] = [];
  const [header, ...body] = lines;
  const expected = 'slug,name,category,description,base_price_cents,sizes';
  if ((header ?? '').trim() !== expected) {
    return { rows: [], errors: [`Header must be exactly "${expected}".`] };
  }
  body.forEach((line, index) => {
    const fields = parseCsvLine(line);
    const where = `line ${index + 2}`;
    if (fields.length !== 6) {
      errors.push(`${where}: expected 6 fields, got ${fields.length}.`);
      return;
    }
    const [slug, name, category, description, priceRaw, sizesRaw] = fields as [string, string, string, string, string, string];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      errors.push(`${where}: slug "${slug}" must be lowercase kebab-case.`);
      return;
    }
    const basePriceCents = Number(priceRaw);
    if (!Number.isInteger(basePriceCents) || basePriceCents < 0) {
      errors.push(`${where}: base_price_cents "${priceRaw}" must be a non-negative integer (cents, never dollars).`);
      return;
    }
    const sizes: MenuCsvRow['sizes'] = [];
    if (sizesRaw.trim().length > 0) {
      for (const part of sizesRaw.split('|')) {
        const [sizeSlug, sizePrice] = part.split(':');
        const priceCents = Number(sizePrice);
        if (!sizeSlug || !Number.isInteger(priceCents) || priceCents < 0) {
          errors.push(`${where}: size "${part}" must be "<slug>:<cents>".`);
          continue;
        }
        sizes.push({ slug: sizeSlug, label: /^\d+$/.test(sizeSlug) ? `${sizeSlug} oz` : sizeSlug, price_cents: priceCents });
      }
    }
    rows.push({ slug, name: name.trim(), category: category.trim(), description: description.trim(), basePriceCents, sizes });
  });
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slug)) errors.push(`Duplicate slug "${row.slug}".`);
    seen.add(row.slug);
  }
  return { rows, errors };
}
