import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { tenantPackFromSetup, type TenantPack, type TenantSetupInput } from '@platform/tenant-config';

import { log } from './log';
import type { OrgDraft } from './org-input';

const RESERVED = new Set(['_template']);

/** What a best-effort write did, so the caller can report it instead of guessing. */
export type TenantPackWrite =
  | { readonly kind: 'written'; readonly path: string }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'refused'; readonly reason: 'exists' | 'reserved' }
  | { readonly kind: 'failed' };

export class TenantPackRefusedError extends Error {
  constructor(readonly reason: 'exists' | 'reserved') {
    super(reason === 'exists'
      ? 'Refusing to overwrite an existing tenant folder.'
      : 'Refusing to write a reserved tenant slug.');
    this.name = 'TenantPackRefusedError';
  }
}

function reservedSlug(slug: string): boolean {
  return RESERVED.has(slug) || slug.startsWith('.') || /[\\/]/.test(slug);
}

function hoursRecord(draft: OrgDraft): TenantSetupInput['location'] {
  if (!draft.location) return null;
  const hours: Record<string, { open: string; close: string }[]> = {};
  for (const [day, spans] of Object.entries(draft.location.hours)) {
    hours[day] = (spans ?? []).map((span) => ({ open: span.open, close: span.close }));
  }
  return {
    name: draft.location.name,
    address: {
      street: draft.location.address.street ?? '',
      city: draft.location.address.city ?? '',
      region: draft.location.address.region ?? '',
      postal: draft.location.address.postal ?? '',
    },
    timezone: draft.location.timezone,
    hours,
  };
}

export function setupInputFromDraft(draft: OrgDraft): TenantSetupInput {
  return {
    slug: draft.slug,
    name: draft.name,
    ownerEmail: draft.ownerEmail,
    organizationKind: draft.organizationKind,
    networkSlug: draft.networkSlug,
    location: hoursRecord(draft),
    modules: draft.modules.map((module) => ({ key: module.key, version: module.version })),
  };
}

export function tenantPackFromDraft(draft: OrgDraft): TenantPack {
  return tenantPackFromSetup(setupInputFromDraft(draft));
}

export function tenantsRootFrom(cwd: string, envDir?: string): string | null {
  if (envDir && envDir.trim()) return resolve(envDir);
  for (const candidate of [join(cwd, 'tenants'), join(cwd, '..', '..', 'tenants'), join(cwd, '..', 'tenants')]) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

/**
 * True when this checkout already has a tenant folder for the slug.
 *
 * Checked before provisioning, so an organization named after a committed
 * tenant is refused up front rather than created and then left without the
 * folder its name implies. Always false on a host with no tenants/ directory
 * (a Vercel function), where nothing is ever written either.
 */
export function tenantFolderTaken(slug: string, cwd = process.cwd()): boolean {
  const root = tenantsRootFrom(cwd, process.env.TENANTS_DIR);
  return root !== null && (reservedSlug(slug) || existsSync(join(root, slug)));
}

/**
 * Writes the pack under <root>/<slug>, refusing a folder that already exists.
 *
 * Creating an organization named "Coffee Story" used to rewrite
 * tenants/coffee-story/ in place, with no backup, and report success. The
 * non-recursive mkdir is the check: it fails with EEXIST atomically, so two
 * concurrent creates of one slug cannot both win, which a separate existsSync
 * could not promise. Overwriting takes an explicit opt-in.
 */
export function writeTenantPack(
  root: string,
  pack: TenantPack,
  options: { readonly overwrite?: boolean } = {},
): string {
  if (reservedSlug(pack.slug)) throw new TenantPackRefusedError('reserved');
  const dest = join(root, pack.slug);
  try {
    mkdirSync(dest, { recursive: options.overwrite === true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new TenantPackRefusedError('exists');
    throw error;
  }
  for (const [name, body] of Object.entries(pack.files)) {
    const content = typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`;
    writeFileSync(join(dest, name), content);
  }
  return dest;
}

/** Best-effort write for local/dev factory trees. Skipped on hosts without tenants/. */
export function tryWriteTenantPack(pack: TenantPack, cwd = process.cwd()): TenantPackWrite {
  const root = tenantsRootFrom(cwd, process.env.TENANTS_DIR);
  if (!root) return { kind: 'skipped' };
  try {
    return { kind: 'written', path: writeTenantPack(root, pack) };
  } catch (error) {
    if (error instanceof TenantPackRefusedError) {
      log.warn('organization.tenant_pack_refused', { slug: pack.slug, reason: error.reason });
      return { kind: 'refused', reason: error.reason };
    }
    log.error('organization.tenant_pack_write_failed', { slug: pack.slug }, error);
    return { kind: 'failed' };
  }
}
