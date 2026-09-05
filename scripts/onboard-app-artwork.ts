/**
 * The parts of a tenant that are generated outside its JSON/menu slot.
 *
 * `scripts/onboard-tenant-slots.ts` made brand.json, modules.json, the compiled
 * menu, the menu photographs and the product cut-outs per-slug, so N tenants
 * coexist in the tree. These do not follow, for two different reasons:
 *
 *  - App icon, splash, adaptive icon, favicon, web manifest and the Expo icon
 *    project live under a per-slug directory. `app.config.ts` selects that
 *    directory from `EXPO_PUBLIC_TENANT`, so one binary still carries one
 *    identity while every applied tenant stays reproducible from one commit.
 *  - Gift-card, hero and rewards illustrations are a fixed set of platform slots
 *    with persisted keys (`gift-designs.ts` names `quiet-hour.webp` by hand, and
 *    the key is stored on issued gift cards). Per-slug art would need a platform
 *    default set for tenants that ship none, which does not exist yet.
 *
 * Every guard here exists because the previous version crashed or deleted files
 * on a tenant that ships no photography (`demo-roastery`, deliberately).
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TenantSurface } from '../packages/tenant-config/src/index.js';
import { reconcileTenantArtwork } from './lib/onboard-guest-reconciliation.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Generated source -> path under an app's assets/tenants/<slug> directory. */
const CUSTOMER_ARTWORK: readonly (readonly [string, string])[] = [
  ['splash-logo.png', 'brand/logo.png'],
  ['icon.png', 'images/icon.png'],
  ['android-foreground.png', 'images/android-icon-foreground.png'],
  ['android-background.png', 'images/android-icon-background.png'],
  ['android-monochrome.png', 'images/android-icon-monochrome.png'],
  ['favicon.png', 'images/favicon.png'],
  ['android-foreground.png', 'expo.icon/Assets/mark.png'],
];

const KIOSK_ARTWORK: readonly (readonly [string, string])[] = [
  ['icon.png', 'images/icon.png'],
  ['android-foreground.png', 'images/android-icon-foreground.png'],
  ['android-background.png', 'images/android-icon-background.png'],
  ['android-monochrome.png', 'images/android-icon-monochrome.png'],
  ['favicon.png', 'images/favicon.png'],
  ['splash-logo.png', 'brand/logo.png'],
  ['android-foreground.png', 'expo.icon/Assets/mark.png'],
];

const CUSTOMER_WEB_ARTWORK: readonly (readonly [string, string])[] = [
  ['icon.png', 'icon.png'], ['icon-180.png', 'icon-180.png'],
];

/** Fixed-name illustration slots, seeded from the tenant folder. Customer only. */
const ILLUSTRATIONS: readonly (readonly [string, readonly string[]])[] = [
  ['gift', ['.webp', '.png']],
  ['hero', ['.webp', '.png', '.mp4']],
  ['rewards', ['.webp', '.png']],
];

const CUSTOMER_REQUIRED_ILLUSTRATIONS = [
  'hero/home-hero.mp4', 'hero/stones.webp',
  'gift/birthday-cake.webp', 'gift/birthday-confetti.webp', 'gift/congrats-bloom.webp',
  'gift/congrats-gold.webp', 'gift/grateful.webp', 'gift/healing-oil.webp',
  'gift/quiet-hour.webp', 'gift/thank-you.webp', 'rewards/liquid-nebula.webp',
] as const;

export type ArtworkBrand = {
  identity: { name: string };
  tokens: { primary?: string; surface?: string };
  copy: Record<string, string>;
};

function writeExpoIconConfig(surface: unknown, target: string): void {
  const color = typeof surface === 'string' && HEX.test(surface) ? surface : '#FFFFFF';
  const channels = [1, 3, 5].map((offset) => (Number.parseInt(color.slice(offset, offset + 2), 16) / 255).toFixed(5));
  const config = {
    fill: { 'automatic-gradient': `extended-srgb:${channels.join(',')},1.00000` },
    groups: [{
      layers: [{ 'image-name': 'mark.png', name: 'mark' }],
      shadow: { kind: 'neutral', opacity: 0.5 },
      translucency: { enabled: false, value: 0.5 },
    }],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  };
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
}

function writeWebManifest(brand: ArtworkBrand, target: string): void {
  const pointsName = brand.copy.pointsName ?? 'Points';
  const manifest = {
    name: brand.identity.name,
    short_name: brand.identity.name,
    description: `Order ahead, send a gift card, and earn ${pointsName} at ${brand.identity.name}.`,
    start_url: '/', display: 'standalone', background_color: brand.tokens.surface,
    theme_color: brand.tokens.primary,
    icons: [{ src: '/icon.png', sizes: '1024x1024', type: 'image/png' }],
  };
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

function copyArtwork(generated: string, appRoot: string, mappings: readonly (readonly [string, string])[]): number {
  for (const [source, destination] of mappings) {
    const from = join(generated, source);
    const to = join(appRoot, destination);
    mkdirSync(join(to, '..'), { recursive: true });
    copyFileSync(from, to);
  }
  return mappings.length;
}

function assertCompleteSources(
  generated: string,
  tenantDir: string,
  surfaces: readonly TenantSurface[],
): void {
  const mappings = surfaces.flatMap((surface) => surface === 'customer'
    ? [...CUSTOMER_ARTWORK, ...CUSTOMER_WEB_ARTWORK]
    : KIOSK_ARTWORK);
  const missingGenerated = [...new Set(mappings.map(([source]) => source))]
    .filter((source) => !existsSync(join(generated, source)));
  if (missingGenerated.length > 0) {
    throw new Error(`Generated artwork is incomplete: ${missingGenerated.join(', ')}`);
  }
  if (!surfaces.includes('customer')) return;
  const missingIllustrations = CUSTOMER_REQUIRED_ILLUSTRATIONS
    .filter((source) => !existsSync(join(tenantDir, 'assets', source)));
  if (missingIllustrations.length > 0) {
    throw new Error(`Customer artwork is incomplete: ${missingIllustrations.join(', ')}`);
  }
}

/** Mirrors one complete tenant illustration group and removes stale files. */
function syncIllustrations(from: string, to: string, extensions: readonly string[]): number {
  // lstat, not stat: copyFileSync follows symlinks, and a tenant asset folder
  // is not a place a link should be able to reach out of.
  const sources = existsSync(from)
    ? readdirSync(from).filter((file) => extensions.some((extension) => file.endsWith(extension))
        && lstatSync(join(from, file)).isFile())
    : [];
  if (sources.length === 0) return 0;
  mkdirSync(to, { recursive: true });
  const wanted = new Set(sources);
  for (const file of readdirSync(to)) {
    if (extensions.some((extension) => file.endsWith(extension)) && !wanted.has(file)) unlinkSync(join(to, file));
  }
  for (const file of sources) copyFileSync(join(from, file), join(to, file));
  return sources.length;
}

/**
 * Refreshes the per-tenant artwork for the tenant being applied.
 *
 * Source completeness is checked before any destination changes, preventing a
 * partial or asset-less tenant from inheriting the previously selected brand.
 */
export function applyAppArtwork(
  root: string,
  slug: string,
  tenantDir: string,
  brand: ArtworkBrand,
  surfaces: readonly ('customer' | 'kiosk')[],
): string {
  const customer = join(root, 'apps', 'customer');
  const kiosk = join(root, 'apps', 'kiosk');
  const customerAssets = join(customer, 'assets', 'tenants', slug);
  const customerWeb = join(customer, 'public', 'tenants', slug);
  const kioskAssets = join(kiosk, 'assets', 'tenants', slug);
  const generated = join(tenantDir, 'app-store', 'generated');
  assertCompleteSources(generated, tenantDir, surfaces);

  let illustrations = 0;
  if (surfaces.includes('customer')) {
    for (const [group, extensions] of ILLUSTRATIONS) {
      illustrations += syncIllustrations(
        join(tenantDir, 'assets', group), join(customerAssets, group), extensions,
      );
    }
  }

  let copied = 0;
  if (surfaces.includes('customer')) {
    copied += copyArtwork(generated, customerAssets, CUSTOMER_ARTWORK);
    copied += copyArtwork(generated, customerWeb, CUSTOMER_WEB_ARTWORK);
  }
  if (surfaces.includes('kiosk')) copied += copyArtwork(generated, kioskAssets, KIOSK_ARTWORK);
  const roots = surfaces.map((surface) => surface === 'customer' ? customerAssets : kioskAssets);
  for (const appRoot of roots) {
    const expoIcon = join(appRoot, 'expo.icon');
    if (existsSync(expoIcon)) writeExpoIconConfig(brand.tokens.surface, join(expoIcon, 'icon.json'));
  }
  if (surfaces.includes('customer')) {
    mkdirSync(customerWeb, { recursive: true });
    writeWebManifest(brand, join(customerWeb, 'manifest.webmanifest'));
  }
  reconcileTenantArtwork(root, slug, surfaces);
  const destination = surfaces.length > 0 ? surfaces.join(' + ') : 'no guest apps';
  return `${copied} icon/splash files for ${destination}, ${illustrations} illustrations (${slug})`;
}
