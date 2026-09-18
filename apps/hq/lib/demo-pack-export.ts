/**
 * The runtime pack a guest-app export fetches from GET /d/pack.json.
 *
 * demo-pack.ts reduces a stored pack into what the HQ landing page draws.
 * This module does the opposite: it hands the pack almost whole to the real
 * customer/kiosk bundle, which already reads a tenant's brand.json/menu.json/
 * modules.json shape unconditionally at module load (apps/*/src/tenants/
 * selected.ts). Whole is not blind: every pack came from a scraped website or
 * a third-party listing, so brand is re-validated with the same parser a
 * committed tenant folder must pass, menu is reshaped and bounded into
 * exactly the fields both apps read, modules goes through the same parser
 * onboarding uses, and a media reference is admitted only in the shape
 * DEMO_MEDIA_NAME allows. Any failure returns null -- the route turns that
 * into a 404, never a partial pack a guest app would half-render.
 *
 * Every item always carries `optionGroups: []`. Packs never carry real
 * option customization, and both apps' bundled-catalog readers index into
 * that field unconditionally: apps/kiosk/src/data/menu-source.ts drops an
 * item outright when the field cannot be parsed as an array, and
 * apps/customer/src/data/catalog-data.ts flat-maps it at module load with no
 * null guard at all. A missing field must never reach either.
 */
import { parseTenantModulesManifest } from '@platform/module-kit';
import { parseTenantManifest } from '@platform/tenant-config';

import type { DemoBuilder } from './demo-builder';
import { DEMO_MEDIA_NAME } from './demo-pack';

const LIMIT = {
  categories: 40, items: 300, sizes: 6, name: 120, description: 600, categoryId: 80, slug: 40,
} as const;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {};
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** A media reference the real app can fetch: through the cookie-gated proxy, never a bare name. */
function mediaPath(value: unknown): string | null {
  return typeof value === 'string' && DEMO_MEDIA_NAME.test(value) ? `/d/media/${encodeURIComponent(value)}` : null;
}

export type DemoPackSize = { readonly slug: string; readonly priceCents: number };
export type DemoPackItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly sizes: readonly DemoPackSize[];
  readonly optionGroups: readonly never[];
};
export type DemoPackMenu = {
  readonly version: 1;
  readonly categories: readonly { readonly id: string; readonly title: string }[];
  readonly items: readonly DemoPackItem[];
};
export type DemoPackMedia = { readonly logo: string | null; readonly items: Readonly<Record<string, string>> };

export type DemoPackExport = {
  readonly version: 1;
  readonly businessName: string;
  readonly brand: Readonly<Record<string, unknown>>;
  readonly menu: DemoPackMenu;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly media: DemoPackMedia;
  readonly builder: { readonly name: string; readonly contactHref: string | null };
  readonly removeHref: string;
  readonly expiresAt: string;
};

function sizesOf(raw: unknown): DemoPackSize[] {
  return list(raw)
    .map(record)
    .map((entry) => {
      const slug = str(entry.slug, LIMIT.slug);
      const priceCents = cents(entry.priceCents);
      return slug !== null && priceCents !== null ? { slug, priceCents } : null;
    })
    .filter((size): size is DemoPackSize => size !== null)
    .slice(0, LIMIT.sizes);
}

function itemOf(raw: unknown): DemoPackItem | null {
  const source = record(raw);
  const id = str(source.id, LIMIT.slug);
  const name = str(source.name, LIMIT.name);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    description: str(source.description, LIMIT.description) ?? '',
    category: str(source.category, LIMIT.categoryId) ?? '',
    sizes: sizesOf(source.sizes),
    optionGroups: [],
  };
}

/** A pack with no readable category or item cannot be a menu; the whole pack fails closed. */
function menuOf(raw: unknown): DemoPackMenu | null {
  const source = record(raw);
  const categories = list(source.categories)
    .map(record)
    .map((category) => {
      const id = str(category.id, LIMIT.categoryId);
      const title = str(category.title, LIMIT.name);
      return id !== null && title !== null ? { id, title } : null;
    })
    .filter((category): category is { id: string; title: string } => category !== null)
    .slice(0, LIMIT.categories);
  const items = list(source.items)
    .map(itemOf)
    .filter((item): item is DemoPackItem => item !== null)
    .slice(0, LIMIT.items);
  return categories.length > 0 && items.length > 0 ? { version: 1, categories, items } : null;
}

function mediaOf(raw: unknown): DemoPackMedia {
  const source = record(raw);
  const items: Record<string, string> = {};
  for (const [itemId, name] of Object.entries(record(source.items))) {
    const path = mediaPath(name);
    if (path !== null) items[itemId] = path;
  }
  return { logo: mediaPath(source.logo), items };
}

/** Builds the response body for GET /d/pack.json, or null when the pack cannot be trusted whole. */
export function demoPackExport(input: {
  readonly pack: unknown;
  readonly businessName: string;
  readonly token: string;
  readonly builder: DemoBuilder;
  readonly expiresAt: string;
}): DemoPackExport | null {
  const source = record(input.pack);
  const brand = parseTenantManifest(source.brand);
  const menu = menuOf(source.menu);
  const modules = parseTenantModulesManifest(source.modules);
  if (brand.kind !== 'ok' || menu === null || modules.kind !== 'ok') return null;
  return {
    version: 1,
    businessName: input.businessName,
    brand: brand.manifest.raw,
    menu,
    // Re-validated shape, original object: both apps re-derive their module
    // keys from this at their own load time (installedModuleKeys), the same
    // way a committed tenant folder's modules.json is read.
    modules: record(source.modules),
    media: mediaOf(source.media),
    builder: { name: input.builder.name, contactHref: input.builder.contactHref },
    removeHref: `/d/${input.token}/remove`,
    expiresAt: input.expiresAt,
  };
}
