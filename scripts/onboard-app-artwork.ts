/**
 * The parts of a tenant that stay single-slot, and why.
 *
 * `scripts/onboard-tenant-slots.ts` made brand.json, modules.json, the compiled
 * menu, the menu photographs and the product cut-outs per-slug, so N tenants
 * coexist in the tree. These do not follow, for two different reasons:
 *
 *  - App icon, splash, adaptive icon, favicon, web manifest and the Expo icon
 *    project are named at fixed paths by `app.config.ts` and by native build
 *    config. One binary carries exactly one of each -- rule 7 -- and Apple will
 *    not let 50 franchisee brands share one listing with 50 icons. Making these
 *    per-slug would buy nothing a build could use.
 *  - Gift-card, hero and rewards illustrations are a fixed set of platform slots
 *    with persisted keys (`gift-designs.ts` names `quiet-hour.webp` by hand, and
 *    the key is stored on issued gift cards). Per-slug art would need a platform
 *    default set for tenants that ship none, which does not exist yet.
 *
 * So applying a second tenant overwrites this artwork with the second tenant's,
 * and the drift test asserts it against the *selected* slug only. Every guard
 * here exists because the previous version crashed or deleted files on a tenant
 * that ships no photography (`demo-roastery`, deliberately).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Generated source -> path under apps/customer, relative to the app root. */
const CUSTOMER_ARTWORK: readonly (readonly [string, string])[] = [
  ['splash-logo.png', 'assets/brand/logo.png'],
  ['icon.png', 'assets/images/icon.png'],
  ['android-foreground.png', 'assets/images/android-icon-foreground.png'],
  ['android-background.png', 'assets/images/android-icon-background.png'],
  ['android-monochrome.png', 'assets/images/android-icon-monochrome.png'],
  ['favicon.png', 'assets/images/favicon.png'],
  ['android-foreground.png', 'assets/expo.icon/Assets/mark.png'],
  ['icon.png', 'public/icon.png'],
  ['icon-180.png', 'public/icon-180.png'],
];

const KIOSK_ARTWORK: readonly (readonly [string, string])[] = [
  ['icon.png', 'assets/images/icon.png'],
  ['android-foreground.png', 'assets/images/android-icon-foreground.png'],
  ['android-background.png', 'assets/images/android-icon-background.png'],
  ['android-monochrome.png', 'assets/images/android-icon-monochrome.png'],
  ['favicon.png', 'assets/images/favicon.png'],
  ['splash-logo.png', 'assets/brand/logo.png'],
  ['android-foreground.png', 'assets/expo.icon/Assets/mark.png'],
];

/** Fixed-name illustration slots, seeded from the tenant folder. Customer only. */
const ILLUSTRATIONS: readonly (readonly [string, readonly string[]])[] = [
  ['gift', ['.webp', '.png']],
  ['hero', ['.webp', '.png', '.mp4']],
  ['rewards', ['.webp', '.png']],
];

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
  let copied = 0;
  for (const [source, destination] of mappings) {
    const from = join(generated, source);
    if (!existsSync(from)) continue;
    const to = join(appRoot, destination);
    mkdirSync(join(to, '..'), { recursive: true });
    copyFileSync(from, to);
    copied += 1;
  }
  return copied;
}

/**
 * Mirrors an illustration group, and leaves the app alone when the tenant has none.
 *
 * The "leaves it alone" half is the fix: the previous version unlinked whatever
 * the destination held when the source was empty, so applying a tenant with no
 * gift artwork deleted the assets `gift-designs.ts` statically imports and broke
 * the bundle for every tenant.
 */
function syncIllustrations(from: string, to: string, extensions: readonly string[]): number {
  const sources = existsSync(from)
    ? readdirSync(from).filter((file) => extensions.some((extension) => file.endsWith(extension)))
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
 * Refreshes the single-slot artwork for the tenant being applied.
 *
 * Returns a line for the CLI rather than throwing on missing artwork: a tenant
 * with no `assets/logo.png` has no generated icons, which is a step that has not
 * run yet, not a broken apply.
 */
export function applyAppArtwork(root: string, slug: string, tenantDir: string, brand: ArtworkBrand): string {
  const customer = join(root, 'apps', 'customer');
  const kiosk = join(root, 'apps', 'kiosk');
  const generated = join(tenantDir, 'app-store', 'generated');

  let illustrations = 0;
  for (const [group, extensions] of ILLUSTRATIONS) {
    illustrations += syncIllustrations(join(tenantDir, 'assets', group), join(customer, 'assets', group), extensions);
  }

  if (!existsSync(generated)) {
    const note = illustrations > 0 ? `; ${illustrations} illustrations synced` : '';
    return `icons and splash skipped -- tenants/${slug}/app-store/generated does not exist yet${note}`;
  }

  const copied = copyArtwork(generated, customer, CUSTOMER_ARTWORK) + copyArtwork(generated, kiosk, KIOSK_ARTWORK);
  for (const appRoot of [customer, kiosk]) {
    const expoIcon = join(appRoot, 'assets', 'expo.icon');
    if (existsSync(expoIcon)) writeExpoIconConfig(brand.tokens.surface, join(expoIcon, 'icon.json'));
  }
  mkdirSync(join(customer, 'public'), { recursive: true });
  writeWebManifest(brand, join(customer, 'public', 'manifest.webmanifest'));
  return `${copied} icon/splash files, the web manifest, and ${illustrations} illustrations`;
}
