import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type {
  ProductCutoutCorrection,
  ProductCutoutFault,
  ProductCutoutGeometry,
  ProductCutoutMatte,
  ProductCutoutMeasurement,
} from '@platform/ui/src/product-cutout';

export type ProductCutoutManifestEntry = {
  hash: string;
  measured: ProductCutoutMeasurement;
  geometry: ProductCutoutGeometry;
  matte: ProductCutoutMatte;
  correction: ProductCutoutCorrection;
  faults?: ProductCutoutFault[];
};

export const PRODUCT_EXT = '.webp';
export const PRODUCT_MASTER_EXT = '.png';

export function productCutoutTenant(argv: string[], envTenant?: string): string {
  const tenantArg = argv.indexOf('--tenant');
  const fromArg = tenantArg >= 0 ? argv[tenantArg + 1] : undefined;
  const slug = fromArg ?? envTenant;
  if (!slug) {
    throw new Error('--tenant <slug> or TENANT/env tenant is required; refusing to default to coffee-story');
  }
  return slug;
}

export function productCutoutPaths(cwd: string, tenant: string) {
  const products = join(cwd, 'tenants', tenant, 'assets/products');
  return {
    products,
    manifest: join(products, '.cutouts.json'),
    contactSheet: join(cwd, 'tenants', tenant, 'assets/product-cutouts-contact-sheet.png'),
  };
}

export const hashProductCutout = (buffer: Buffer | Uint8Array) =>
  createHash('sha256').update(buffer).digest('hex');

export const productStem = (file: string) => file.replace(/\.png$/, '');
