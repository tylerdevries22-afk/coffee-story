import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { tenantPackFromSetup, type TenantPack, type TenantSetupInput } from '@platform/tenant-config';

import { log } from './log';
import type { OrgDraft } from './org-input';

const RESERVED = new Set(['_template']);

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

export function writeTenantPack(root: string, pack: TenantPack): string {
  if (RESERVED.has(pack.slug) || pack.slug.startsWith('.')) {
    throw new Error('Refusing to write a reserved tenant slug.');
  }
  const dest = join(root, pack.slug);
  mkdirSync(dest, { recursive: true });
  for (const [name, body] of Object.entries(pack.files)) {
    const content = typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`;
    writeFileSync(join(dest, name), content);
  }
  return dest;
}

/** Best-effort write for local/dev factory trees. No-ops on hosts without tenants/. */
export function tryWriteTenantPack(pack: TenantPack, cwd = process.cwd()): string | null {
  const root = tenantsRootFrom(cwd, process.env.TENANTS_DIR);
  if (!root) return null;
  try {
    return writeTenantPack(root, pack);
  } catch (error) {
    log.error('organization.tenant_pack_write_failed', { slug: pack.slug }, error);
    return null;
  }
}
