import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { BundledTenantMenu } from '@platform/schema';

import type { TenantManifest, TenantSurface } from '../../packages/tenant-config/src/index.js';

function webpSlugs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith('.webp'))
    .map((file) => file.replace(/\.webp$/, '')).sort();
}

export function validateMenuAssets(
  tenantDir: string, menu: BundledTenantMenu, problems: string[],
): void {
  const actual = new Set(webpSlugs(join(tenantDir, 'assets', 'menu')));
  const expected = new Set(menu.items.map((item) => item.id));
  for (const item of menu.items) {
    if (!actual.has(item.id)) problems.push(`assets/menu/${item.id}.webp is required by menu.csv.`);
  }
  for (const item of actual) {
    if (!expected.has(item)) problems.push(`assets/menu/${item}.webp has no row in menu.csv.`);
  }
}

export function validateGuestAppTenant(brand: TenantManifest, problems: string[]): void {
  if (!brand.identity.name) problems.push('identity.name is required to apply a guest app.');
  if (!brand.identity.bundleId.includes('.')) problems.push('identity.bundleId must be reverse-DNS.');
  if (!brand.identity.kioskBundleId.includes('.')) problems.push('identity.kioskBundleId must be reverse-DNS.');
  if (!brand.identity.scheme) problems.push('identity.scheme is required to apply a guest app.');
  if (!brand.identity.kioskScheme) problems.push('identity.kioskScheme is required to apply a guest app.');
  const monogram = brand.business?.monogram;
  if (typeof monogram !== 'string' || monogram.length < 1 || monogram.length > 3) {
    problems.push('business.monogram (1-3 characters) is required by guest apps.');
  }
  if (!brand.locations[0]?.timezone.includes('/')) {
    problems.push('locations[0].timezone must be an IANA timezone for guest apps.');
  }
  if (typeof brand.features.drops !== 'boolean') {
    problems.push('features.drops must be a boolean for guest apps.');
  }
}

export function validateGuestArtworkInputs(
  dir: string, surfaces: readonly TenantSurface[], problems: string[],
): void {
  const generated = ['splash-logo.png', 'icon.png', 'android-foreground.png',
    'android-background.png', 'android-monochrome.png', 'favicon.png'];
  if (surfaces.includes('customer')) generated.push('icon-180.png');
  const ready = generated.every((file) => existsSync(join(dir, 'app-store', 'generated', file)));
  const hasLogo = ['logo.svg', 'logo.png'].some((file) => existsSync(join(dir, 'assets', file)));
  if (!ready && !hasLogo) {
    problems.push('assets/logo.svg or logo.png is required when generated artwork is incomplete.');
  }
  if (!surfaces.includes('customer')) return;
  const required = [
    'assets/hero/home-hero.mp4', 'assets/hero/stones.webp',
    'assets/gift/birthday-cake.webp', 'assets/gift/birthday-confetti.webp',
    'assets/gift/congrats-bloom.webp', 'assets/gift/congrats-gold.webp',
    'assets/gift/grateful.webp', 'assets/gift/healing-oil.webp',
    'assets/gift/quiet-hour.webp', 'assets/gift/thank-you.webp',
    'assets/rewards/liquid-nebula.webp',
  ];
  for (const relative of required) {
    if (!existsSync(join(dir, relative))) problems.push(`${relative} is required by the customer shell.`);
  }
}

export async function generateAppArtwork(
  tenantDir: string, slug: string, brand: TenantManifest,
): Promise<void> {
  const source = ['logo.svg', 'logo.png'].map((file) => join(tenantDir, 'assets', file))
    .find(existsSync);
  if (!source) {
    console.log(`3. artwork: skipped (add tenants/${slug}/assets/logo.svg or logo.png)`);
    return;
  }
  const sharp = (await import('sharp')).default;
  const output = join(tenantDir, 'app-store', 'generated');
  mkdirSync(output, { recursive: true });
  const logo = readFileSync(source);
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const composite = async (size: number, logoSize: number, background: string | typeof transparent) => (
    sharp({ create: { width: size, height: size, channels: 4, background } })
      .composite([{ input: await sharp(logo).resize(logoSize, logoSize, { fit: 'inside' }).png().toBuffer() }])
  );
  await (await composite(1024, 720, String(brand.tokens.surface ?? '#FFFFFF')))
    .png().toFile(join(output, 'icon.png'));
  await sharp(logo).resize(360, 360, { fit: 'inside' }).png().toFile(join(output, 'splash-logo.png'));
  await (await composite(1024, 560, transparent)).png().toFile(join(output, 'android-foreground.png'));
  const mono = await sharp(logo).resize(280, 280, { fit: 'inside' })
    .ensureAlpha().tint('#FFFFFF').png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: transparent } })
    .composite([{ input: mono }]).png().toFile(join(output, 'android-monochrome.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4,
    background: String(brand.tokens.primary ?? '#1C1917') } })
    .png().toFile(join(output, 'android-background.png'));
  await sharp(join(output, 'icon.png')).resize(48, 48).png().toFile(join(output, 'favicon.png'));
  await sharp(join(output, 'icon.png')).resize(180, 180).png().toFile(join(output, 'icon-180.png'));
  console.log(`3. artwork: generated -> tenants/${slug}/app-store/generated/`);
}
