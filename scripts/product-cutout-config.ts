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
  return tenantArg >= 0 ? (argv[tenantArg + 1] ?? 'coffee-story') : (envTenant ?? 'coffee-story');
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
