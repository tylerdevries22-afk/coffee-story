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

const MAX_CSV_BYTES = 1024 * 1024;
const ITEM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function quotesClose(line: string): boolean {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '"') continue;
    if (quoted && line[index + 1] === '"') index += 1;
    else quoted = !quoted;
  }
  return !quoted;
}

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
  if (new TextEncoder().encode(content).byteLength > MAX_CSV_BYTES) {
    return { rows: [], errors: ['Menu CSV must not exceed 1 MB.'] };
  }
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const errors: string[] = [];
  const rows: MenuCsvRow[] = [];
  const [header, ...body] = lines;
  const expected = 'slug,name,category,description,base_price_cents,sizes';
  if ((header ?? '').trim() !== expected) {
    return { rows: [], errors: [`Header must be exactly "${expected}".`] };
  }
  body.forEach((line, index) => {
    const where = `line ${index + 2}`;
    if (!quotesClose(line)) {
      errors.push(`${where}: quoted field is not closed.`);
      return;
    }
    const fields = parseCsvLine(line);
    if (fields.length !== 6) {
      errors.push(`${where}: expected 6 fields, got ${fields.length}.`);
      return;
    }
    const [slug, name, category, description, priceRaw, sizesRaw] = fields as [string, string, string, string, string, string];
    if (!ITEM_SLUG.test(slug) || slug.length > 80) {
      errors.push(`${where}: slug "${slug}" must be lowercase kebab-case.`);
      return;
    }
    if (name.trim().length < 1 || name.trim().length > 120
      || category.trim().length < 1 || category.trim().length > 120
      || description.trim().length > 1000) {
      errors.push(`${where}: name/category must be 1–120 characters and description at most 1,000.`);
      return;
    }
    const basePriceCents = Number(priceRaw);
    if (!Number.isInteger(basePriceCents) || basePriceCents < 0 || basePriceCents > 10_000_000) {
      errors.push(`${where}: base_price_cents "${priceRaw}" must be a non-negative integer (cents, never dollars).`);
      return;
    }
    const sizes: MenuCsvRow['sizes'] = [];
    if (sizesRaw.trim().length > 0) {
      const parts = sizesRaw.split('|');
      if (parts.length > 20) errors.push(`${where}: at most 20 sizes are allowed.`);
      const seenSizes = new Set<string>();
      for (const part of parts.slice(0, 20)) {
        const [sizeSlug, sizePrice] = part.split(':');
        const priceCents = Number(sizePrice);
        if (!sizeSlug || !ITEM_SLUG.test(sizeSlug) || sizeSlug.length > 40
          || seenSizes.has(sizeSlug) || !Number.isInteger(priceCents)
          || priceCents < 0 || priceCents > 10_000_000) {
          errors.push(`${where}: size "${part}" must be "<slug>:<cents>".`);
          continue;
        }
        seenSizes.add(sizeSlug);
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
