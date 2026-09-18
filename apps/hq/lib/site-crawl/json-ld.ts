/**
 * The few schema.org facts a business publishes about itself on purpose.
 *
 * Site builders and SEO plugins write an Organization or LocalBusiness block
 * with the logo, the social profiles (`sameAs`) and often a contact email.
 * That is the most deliberate statement of identity a page carries, so it is
 * read before guessing from markup. The walk is bounded in depth and in nodes
 * visited, because the JSON is the site's, not ours.
 */
export type JsonLdFacts = {
  readonly logos: readonly string[];
  readonly sameAs: readonly string[];
  readonly emails: readonly string[];
};

const MAX_DEPTH = 8;
const MAX_NODES = 2_000;
const MAX_EACH = 12;

function urlOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return urlOf(record.url ?? record.contentUrl ?? record['@id']);
  }
  return null;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

export function readJsonLd(blocks: readonly string[]): JsonLdFacts {
  const logos: string[] = [];
  const sameAs: string[] = [];
  const emails: string[] = [];
  let visited = 0;

  const add = (list: string[], value: string | null): void => {
    if (value !== null && list.length < MAX_EACH && !list.includes(value)) list.push(value);
  };

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || visited >= MAX_NODES || node === null || typeof node !== 'object') return;
    visited += 1;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    add(logos, urlOf(record.logo));
    for (const profile of strings(record.sameAs)) add(sameAs, profile.trim());
    for (const email of strings(record.email)) add(emails, email.trim().replace(/^mailto:/i, ''));
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'logo' && typeof value === 'object') walk(value, depth + 1);
    }
  };

  for (const block of blocks) {
    try {
      walk(JSON.parse(block) as unknown, 0);
    } catch {
      // A malformed block is the site's problem; the rest of the page still counts.
    }
  }
  return { logos, sameAs, emails };
}
