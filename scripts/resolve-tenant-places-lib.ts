import { join } from 'node:path';

const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Returns the only brand path a tenant slug is allowed to name. */
export function tenantBrandPath(root: string, slug: string): string {
  if (!TENANT_SLUG.test(slug)) {
    throw new Error(`Invalid tenant slug "${slug}"; expected lowercase kebab-case.`);
  }
  return join(root, 'tenants', slug, 'brand.json');
}
