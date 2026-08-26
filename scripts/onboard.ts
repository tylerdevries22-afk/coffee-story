/**
 * Tenant onboarding: `pnpm onboard --tenant <slug>` (add `--apply` to point
 * the customer and kiosk apps' bundled tenant at this slug, and optionally
 * pass an existing Supabase identity with `--owner-user-id <uuid>`).
 *
 * Idempotent by construction: brand upserts on slug, the location on
 * (brand, name), menu items on (menu, slug); generated files overwrite their
 * previous versions.
 *
 * What runs depends on what is configured -- each step says what it did or
 * why it skipped, and the exit code is honest:
 *   1. Validate tenants/<slug>/brand.json and menu.csv.
 *   2. With SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: upsert brand (fees,
 *      rule-5 flags, brand_config), location, and the menu.
 *   3. With assets/logo.svg: generate icon/splash/adaptive art (sharp) into
 *      tenants/<slug>/app-store/generated/.
 *   4. Emit the app-store listing draft and screenshots checklist.
 *   5. With --apply: refresh the generated customer and kiosk tenant bundles
 *      so both binaries ship this tenant (drift tests pin every copy).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildTenantMenu,
  parseMenuCsv,
  type BundledTenantMenu,
  type TenantMenuCategory,
} from '@platform/schema';
import { APP_COLOR_KEYS } from '@platform/ui/app-tokens';
import { isRegisteredFont } from '@platform/ui/font-registry';

const DATABASE_TIMEOUT_MS = 10_000;

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(DATABASE_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await fetch(input, { ...init, signal });
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`Supabase returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Supabase request failed');
}

async function syncMenuImage(
  db: SupabaseClient,
  brandId: string,
  itemId: string,
  itemSlug: string,
  tenantDirectory: string,
): Promise<boolean> {
  const imagePath = join(tenantDirectory, 'assets', 'menu', `${itemSlug}.webp`);
  if (!existsSync(imagePath)) return false;
  const bytes = readFileSync(imagePath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const directory = `${brandId}/menu-item/${itemId}`;
  const objectPath = `${directory}/${checksum}.webp`;
  const existing = await db.storage.from('menu-images').list(directory, {
    limit: 1, search: `${checksum}.webp`,
  });
  if (existing.error) throw existing.error;
  if (!(existing.data ?? []).some((object) => object.name === `${checksum}.webp`)) {
    const uploaded = await db.storage.from('menu-images').upload(objectPath, bytes, {
      contentType: 'image/webp', cacheControl: '31536000', upsert: false,
    });
    if (uploaded.error) {
      // A lost success response is retried against the same immutable key and
      // surfaces as "already exists". Verify the object before calling the
      // tenant sync failed; the checksum path makes that recovery unambiguous.
      const verified = await db.storage.from('menu-images').list(directory, {
        limit: 1, search: `${checksum}.webp`,
      });
      if (verified.error || !(verified.data ?? []).some((object) => object.name === `${checksum}.webp`)) {
        throw uploaded.error;
      }
    }
  }
  const imageUrl = db.storage.from('menu-images').getPublicUrl(objectPath).data.publicUrl;
  const updated = await db.from('menu_items').update({ image_url: imageUrl })
    .eq('id', itemId).eq('brand_id', brandId);
  if (updated.error) throw updated.error;
  return true;
}

type BrandFile = {
  identity: {
    slug: string;
    name: string;
    bundleId: string;
    scheme: string;
    kioskBundleId: string;
    kioskScheme: string;
    easProjectId: string;
    kioskEasProjectId: string;
  };
  tokens: Record<string, unknown> & {
    primary?: string;
    surface?: string;
    /**
     * Optional advanced overrides for the app's internal palette, keyed like
     * the legacy `colors` export. When absent, the theme resolver derives the
     * steps from the seed colors. Passed through to brand_config untouched.
     */
    ramp?: Record<string, string>;
  };
  copy: Record<string, string>;
  features: Record<string, boolean>;
  fees: { feeBps: number; feeBpsTier2: number; tierThresholdCents: number };
  business: Record<string, string>;
  /** Sales-tax authorities the order API charges. Absent = no tax. */
  tax?: { jurisdictions: { id: string; label: string; rate: number }[] };
  /** What points buy, served by /api/loyalty/redeem. */
  loyalty?: { rewards: { slug: string; name: string; points_cost: number }[] };
  /**
   * How the in-store pickup display reads (0030). Optional, and the defaults
   * are the private ones: absent means no status badge on a public wall.
   */
  board?: Record<string, unknown>;
  /**
   * The lobby kiosk's flow (packages/domain/src/kiosk-flow.ts). Optional: the
   * resolver derives a working first screen from the menu when it is absent,
   * which is what makes a new franchise zero-config. Typed here so the DB write
   * below cannot silently omit it.
   */
  kiosk?: Record<string, unknown>;
  location: {
    name: string;
    address: Record<string, string>;
    timezone: string;
    hours: Record<string, { open: string; close: string }[]>;
  };
};

function tenantPrivacyPolicyUrl(website: string | undefined): string {
  if (!website) return '';
  try {
    const origin = new URL(website);
    if (origin.protocol !== 'https:') return '';
    return new URL('/privacy-policy', origin).toString();
  } catch {
    return '';
  }
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slug = argValue('--tenant');
const ownerFlagProvided = process.argv.includes('--owner-user-id');
const ownerUserId = argValue('--owner-user-id');
const apply = process.argv.includes('--apply');
const requireDatabase = process.argv.includes('--require-db');
// The legacy demo-roastery schema fixture intentionally has no photography.
// Production tenants never receive this escape hatch: --require-db otherwise
// guarantees one source image and one uploaded immutable object per menu row.
const imageLessSchemaFixture = process.argv.includes('--allow-imageless-schema-fixture')
  && slug === 'demo-roastery';
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: pnpm onboard --tenant <slug> [--apply] [--owner-user-id <uuid>]');
  process.exit(1);
}
if (ownerFlagProvided && (!ownerUserId || !UUID_PATTERN.test(ownerUserId))) {
  console.error('--owner-user-id must be a valid UUID.');
  process.exit(1);
}

const tenantDir = join(process.cwd(), 'tenants', slug);
const brandPath = join(tenantDir, 'brand.json');
if (!existsSync(brandPath)) {
  console.error(`No tenants/${slug}/brand.json. Copy tenants/_template/ to tenants/${slug}/ first.`);
  process.exit(1);
}

async function run() {
  // 1. Validate ------------------------------------------------------------
  const brand = JSON.parse(readFileSync(brandPath, 'utf8')) as BrandFile;
  const problems: string[] = [];
  if (brand.identity?.slug !== slug) problems.push(`identity.slug is "${brand.identity?.slug}", folder is "${slug}".`);
  if (!brand.identity?.bundleId?.includes('.')) problems.push('identity.bundleId must be reverse-DNS.');
  if (!brand.identity?.kioskBundleId?.includes('.')) problems.push('identity.kioskBundleId must be reverse-DNS.');
  if (!/^[a-z][a-z0-9+.-]*$/.test(brand.identity?.kioskScheme ?? '')) {
    problems.push('identity.kioskScheme must be a valid URL scheme.');
  }
  if (typeof brand.identity?.kioskEasProjectId !== 'string') {
    problems.push('identity.kioskEasProjectId is required (use an empty string until `eas init`).');
  } else if (brand.identity.kioskEasProjectId !== '' && !UUID_PATTERN.test(brand.identity.kioskEasProjectId)) {
    problems.push('identity.kioskEasProjectId must be empty or a valid EAS project UUID.');
  }
  if (!brand.identity?.name) problems.push('identity.name is required.');
  if (!brand.location?.timezone?.includes('/')) problems.push('location.timezone must be an IANA zone.');
  for (const jurisdiction of brand.tax?.jurisdictions ?? []) {
    if (!jurisdiction.id || !jurisdiction.label
      || typeof jurisdiction.rate !== 'number' || jurisdiction.rate < 0 || jurisdiction.rate >= 1) {
      problems.push('tax.jurisdictions entries need id, label and a fractional rate (0.029 = 2.9%).');
      break;
    }
  }
  for (const reward of brand.loyalty?.rewards ?? []) {
    if (!reward.slug || !reward.name || !Number.isInteger(reward.points_cost) || reward.points_cost <= 0) {
      problems.push('loyalty.rewards entries need slug, name and an integer points_cost.');
      break;
    }
  }
  const menuPath = join(tenantDir, 'menu.csv');
  const menu = existsSync(menuPath) ? parseMenuCsv(readFileSync(menuPath, 'utf8')) : { rows: [], errors: [] };
  problems.push(...menu.errors.map((error) => `menu.csv: ${error}`));
  // Option groups per item slug, in the JSONB shape the engine's
  // menu-pricing module reads. Optional; items absent from it sell plain.
  const modifiersPath = join(tenantDir, 'modifiers.json');
  const modifiersBySlug: Record<string, unknown[]> = existsSync(modifiersPath)
    ? JSON.parse(readFileSync(modifiersPath, 'utf8')) as Record<string, unknown[]>
    : {};
  for (const [itemSlug, groups] of Object.entries(modifiersBySlug)) {
    if (!Array.isArray(groups)) {
      problems.push(`modifiers.json: "${itemSlug}" must map to an array of option groups.`);
    } else if (menu.rows.length > 0 && !menu.rows.some((row) => row.slug === itemSlug)) {
      problems.push(`modifiers.json: "${itemSlug}" is not in menu.csv.`);
    } else {
      validateModifierGroups(itemSlug, groups, problems);
    }
  }
  const categoriesPath = join(tenantDir, 'menu-categories.json');
  const categories = existsSync(categoriesPath)
    ? JSON.parse(readFileSync(categoriesPath, 'utf8')) as TenantMenuCategory[]
    : [];
  const packsPath = join(tenantDir, 'packs.json');
  const packsBySlug = readOptionalObjectFile(packsPath, 'packs.json', problems);
  const compiled = buildTenantMenu(menu.rows, categories, modifiersBySlug, packsBySlug);
  problems.push(...compiled.errors);
  validatePackFlow(brand.kiosk, compiled.menu, problems);
  validateTokens(brand.tokens, problems);
  if (apply || (requireDatabase && !imageLessSchemaFixture)) {
    validateMenuAssets(tenantDir, compiled.menu, problems);
  }
  if (apply) validateCustomerShellAssets(tenantDir, problems);
  if (problems.length > 0) {
    console.error(`tenants/${slug} does not validate:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`1. validated brand.json${menu.rows.length ? ` and menu.csv (${menu.rows.length} items)` : ' (no menu.csv)'}`);

  // 2. Database ------------------------------------------------------------
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((requireDatabase || ownerUserId) && (!supabaseUrl || !serviceKey)) {
    throw new Error('--require-db and --owner-user-id need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (supabaseUrl && serviceKey) {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: resilientFetch },
    });
    const { data: brandRow, error: brandError } = await db
      .from('brands')
      .upsert(
        {
          slug,
          name: brand.identity.name,
          fee_bps: brand.fees.feeBps,
          fee_bps_tier2: brand.fees.feeBpsTier2,
          tier_threshold_cents: brand.fees.tierThresholdCents,
          ...brand.features,
          brand_config: {
            // The server needs the app's own scheme to tell this tenant's
            // deep links from anyone else's -- the checkout redirect is
            // validated against it.
            identity: { slug: brand.identity.slug, scheme: brand.identity.scheme },
            tokens: brand.tokens,
            copy: brand.copy,
            business: brand.business,
            ...(brand.tax ? { tax: brand.tax } : {}),
            ...(brand.kiosk ? { kiosk: brand.kiosk } : {}),
            ...(brand.loyalty ? { loyalty: brand.loyalty } : {}),
            // app.loyalty_tier_for reads board.tiers and board.showGuestStatus
            // straight out of this column, so onboarding is the only place a
            // tier ladder is ever written.
            ...(brand.board ? { board: brand.board } : {}),
          },
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();
    if (brandError) throw brandError;

    const { data: location, error: locationError } = await db
      .from('locations')
      .upsert({
        brand_id: brandRow.id,
        name: brand.location.name,
        address: brand.location.address,
        hours: brand.location.hours,
        timezone: brand.location.timezone,
      }, { onConflict: 'brand_id,name' })
      .select('id')
      .single();
    if (locationError) throw locationError;
    const locationId = location.id;

    if (ownerUserId) {
      const { error: ownerError } = await db.from('brand_users').upsert(
        {
          user_id: ownerUserId,
          brand_id: brandRow.id,
          role: 'brand_owner',
          location_ids: [locationId],
        },
        { onConflict: 'user_id,brand_id' },
      );
      if (ownerError) throw ownerError;
    }

    if (menu.rows.length > 0) {
      const { data: savedMenu, error: menuError } = await db
        .from('menus')
        .upsert(
          { brand_id: brandRow.id, name: 'Menu', is_published: true },
          { onConflict: 'brand_id,name' },
        )
        .select('id')
        .single();
      if (menuError) throw menuError;
      const menuId = savedMenu.id;
      const categoryIds = new Map<string, string>();
      for (const [index, category] of compiled.menu.categories.entries()) {
        const { data: saved, error } = await db
          .from('menu_categories')
          .upsert(
            {
              brand_id: brandRow.id,
              menu_id: menuId,
              title: category.title,
              tagline: category.tagline,
              sort_order: index,
            },
            { onConflict: 'menu_id,title' },
          )
          .select('id').single();
        if (error) throw error;
        categoryIds.set(category.title, saved.id);
      }
      const compiledBySlug = new Map(compiled.menu.items.map((item) => [item.id, item]));
      const menuItemIds = new Map<string, string>();
      let uploadedMenuImages = 0;
      for (const [index, row] of menu.rows.entries()) {
        const compiledItem = compiledBySlug.get(row.slug);
        if (!compiledItem) throw new Error(`No compiled menu item for "${row.slug}".`);
        const { data: savedItem, error } = await db.from('menu_items').upsert(
          {
            brand_id: brandRow.id,
            menu_id: menuId,
            category_id: requiredCategoryId(categoryIds, row.category),
            slug: row.slug,
            name: row.name,
            description: row.description,
            base_price_cents: row.basePriceCents,
            sizes: row.sizes,
            modifiers: modifiersBySlug[row.slug] ?? [],
            sort_order: index,
            pack_size: compiledItem.packSize ?? null,
            choice_source: compiledItem.choiceSource ?? null,
            pack_choice_slugs: compiledItem.eligibleItemIds ?? [],
            // The referenced row may be later in menu.csv, so UUIDs are linked
            // only after every stable slug has been upserted below.
            single_item_id: null,
          },
          { onConflict: 'menu_id,slug' },
        ).select('id,slug').single();
        if (error) throw error;
        menuItemIds.set(savedItem.slug, savedItem.id);
        if (await syncMenuImage(db, brandRow.id, savedItem.id, savedItem.slug, tenantDir)) {
          uploadedMenuImages += 1;
        }
      }
      console.log(`   media: ${uploadedMenuImages} versioned menu thumbnails synced to menu-images`);
      for (const item of compiled.menu.items) {
        if (!item.singleItemId) continue;
        const packId = requiredMenuItemId(menuItemIds, item.id);
        const singleId = requiredMenuItemId(menuItemIds, item.singleItemId);
        const { error } = await db.from('menu_items')
          .update({ single_item_id: singleId })
          .eq('id', packId);
        if (error) throw error;
      }
    }
    const ownerSummary = ownerUserId ? ` + owner ${ownerUserId} assigned` : '';
    console.log(`2. database: brand + location ${locationId} + ${menu.rows.length} menu items upserted${ownerSummary}`);
  } else {
    console.log('2. database: skipped (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to seed rows)');
  }

  // 3. Icons and splash ----------------------------------------------------
  const svgLogo = join(tenantDir, 'assets', 'logo.svg');
  const pngLogo = join(tenantDir, 'assets', 'logo.png');
  const logoPath = existsSync(svgLogo) ? svgLogo : pngLogo;
  const generatedDir = join(tenantDir, 'app-store', 'generated');
  if (existsSync(logoPath)) {
    const sharp = (await import('sharp')).default;
    mkdirSync(generatedDir, { recursive: true });
    const surface = typeof brand.tokens.surface === 'string' ? brand.tokens.surface : '#FFFFFF';
    const primary = typeof brand.tokens.primary === 'string' ? brand.tokens.primary : '#1C1917';
    const logo = readFileSync(logoPath);
    // App icon: the logo centred on the brand surface at 1024.
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: surface } })
      .composite([{ input: await sharp(logo).resize(720, 720, { fit: 'inside' }).png().toBuffer() }])
      .png().toFile(join(generatedDir, 'icon.png'));
    // Splash logo on transparency; the splash background color comes from tokens.
    await sharp(logo).resize(360, 360, { fit: 'inside' }).png().toFile(join(generatedDir, 'splash-logo.png'));
    // Android adaptive foreground (safe-zone inset) and monochrome.
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(logo).resize(560, 560, { fit: 'inside' }).png().toBuffer() }])
      .png().toFile(join(generatedDir, 'android-foreground.png'));
    await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{
        input: await sharp(logo).resize(280, 280, { fit: 'inside' }).ensureAlpha().tint('#FFFFFF').png().toBuffer(),
      }])
      .png().toFile(join(generatedDir, 'android-monochrome.png'));
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: primary } })
      .png().toFile(join(generatedDir, 'android-background.png'));
    await sharp(join(generatedDir, 'icon.png')).resize(48, 48).png().toFile(join(generatedDir, 'favicon.png'));
    await sharp(join(generatedDir, 'icon.png')).resize(180, 180).png().toFile(join(generatedDir, 'icon-180.png'));
    console.log(`3. artwork: icon, splash logo, adaptive art -> tenants/${slug}/app-store/generated/`);
  } else {
    console.log(`3. artwork: skipped (add tenants/${slug}/assets/logo.svg or logo.png to generate icons and splash)`);
  }

  // 4. Listing material ----------------------------------------------------
  const appStoreDir = join(tenantDir, 'app-store');
  mkdirSync(appStoreDir, { recursive: true });
  const pointsName = brand.copy.pointsName ?? 'Points';
  const privacyPolicyUrl = tenantPrivacyPolicyUrl(brand.business.website);
  writeFileSync(join(appStoreDir, 'listing.md'), `# ${brand.identity.name} — App Store listing draft

**Subtitle (30 chars):** Order ahead. Earn ${pointsName}.

**Promotional text:** ${brand.copy.orderCta ?? 'Start an order'} from your phone — skip the line,
earn ${pointsName} on every purchase, and catch every limited drop before it's gone.

**Description:**

${brand.identity.name} in your pocket. Order ahead for pickup, customize every
drink exactly how you take it, and pay in seconds. Earn ${pointsName} on every
order and trade them for the drinks you love. Limited drops land first in the
app — with a countdown, so you never miss one.

- Order ahead, skip the line
- ${pointsName} rewards on every purchase
- Limited drops with live countdowns
- Gift cards you can send in a minute
${(brand.features.catering ? '- Catering requests for your events\n' : '')}
**Keywords:** coffee,order ahead,rewards,pickup,${slug}

**Category:** Food & Drink

**Support URL:** ${brand.business.website ?? ''}

**Privacy policy URL:** ${privacyPolicyUrl}

Fill in the marketing URL before submission. Publish a counsel-reviewed copy
of docs/legal/privacy-policy.md at the privacy policy URL above.
`);
  writeFileSync(join(appStoreDir, 'screenshots-checklist.md'), `# Screenshots checklist — ${brand.identity.name}

Capture on the 6.9" and 6.5" iPhone simulators (and 13" iPad if the operator
listing shares assets). Light mode, demo data, full status bar.

- [ ] Home with the live drop hero and countdown
- [ ] Menu, one category open, an 86'd item visible
- [ ] Item sheet with size + options and the price moving on the button
- [ ] Bag with two lines and the earn banner
- [ ] Checkout with the tax breakdown and ${pointsName} redemption on
- [ ] Order tracking on "Being made"
- [ ] Rewards screen with the meter partly filled
- [ ] Gift card send flow, first screen

Rules: no competitor's name or artwork anywhere in frame; only this brand's
own colors, type, and photography (docs/DO-NOT-RESEMBLE.md).
`);
  console.log(`4. listing: listing.md + screenshots-checklist.md -> tenants/${slug}/app-store/`);

  // 5. Apply to the bundled copies ------------------------------------------
  //
  // Two apps bundle the brand file because Metro cannot require a
  // runtime-chosen path. The kiosk's copy was hand-maintained and unwritten by
  // anything, so it silently fell a key behind the moment `board` was added.
  // Both are refreshed here and both are pinned by a drift test.
  const BUNDLED_COPIES = [
    join(process.cwd(), 'apps', 'customer', 'src', 'tenant', 'brand.json'),
    join(process.cwd(), 'apps', 'kiosk', 'src', 'tenant', 'brand.json'),
  ];
  if (apply) {
    for (const destination of BUNDLED_COPIES) copyFileSync(brandPath, destination);
    applyAppBundles(tenantDir, brand, compiled.menu);
    console.log(`5. applied: apps/customer and apps/kiosk now bundle ${slug} (build with TENANT=${slug})`);
  } else {
    console.log(`5. not applied: pass --apply to point apps/customer and apps/kiosk at this tenant`);
  }

  // 6. Product cut-outs ------------------------------------------------------
  //
  // Copied in and codegened rather than resolved at runtime, for the reason
  // this script already handles brand.json the same way: Metro cannot require a
  // path chosen at runtime, so onboarding materialises the choice. Without the
  // generated import map, dropping files in the tenant folder gives Metro
  // nothing to bundle.
  if (apply) {
    console.log(`6. cut-outs: ${applyProductCutouts(tenantDir)}`);
  } else {
    console.log(`6. cut-outs: not applied (pass --apply)`);
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const BASE_COLOR_KEYS = [
  'primary', 'secondary', 'surface', 'surfaceElevated', 'accent',
  'textPrimary', 'textMuted', 'success', 'warning', 'danger',
] as const;

function validateTokens(tokens: BrandFile['tokens'], problems: string[]): void {
  for (const key of BASE_COLOR_KEYS) {
    if (!HEX.test(String(tokens[key] ?? ''))) problems.push(`tokens.${key} must be #RRGGBB.`);
  }
  for (const key of ['fontDisplay', 'fontBody'] as const) {
    const family = tokens[key];
    if (typeof family !== 'string' || !isRegisteredFont(family)) {
      problems.push(`tokens.${key} must be a bundled family: System, Inter, or Fraunces.`);
    }
  }
  const knownRampKeys = new Set<string>(APP_COLOR_KEYS);
  for (const [key, value] of Object.entries(tokens.ramp ?? {})) {
    if (key.startsWith('$')) continue;
    if (!knownRampKeys.has(key)) problems.push(`tokens.ramp.${key} is not a supported app color.`);
    else if (!HEX.test(value)) problems.push(`tokens.ramp.${key} must be #RRGGBB.`);
  }
}

function requiredCategoryId(categoryIds: ReadonlyMap<string, string>, title: string): string {
  const categoryId = categoryIds.get(title);
  if (!categoryId) throw new Error(`No database category was created for "${title}".`);
  return categoryId;
}

function requiredMenuItemId(itemIds: ReadonlyMap<string, string>, slug: string): string {
  const itemId = itemIds.get(slug);
  if (!itemId) throw new Error(`No database menu item was created for "${slug}".`);
  return itemId;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readOptionalObjectFile(path: string, label: string, problems: string[]): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = objectRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (parsed) return parsed;
  } catch {
    // The single structured error below is more useful than a JSON stack trace.
  }
  problems.push(`${label} must contain one JSON object.`);
  return {};
}

type TargetReachability = { valid: boolean; reachesPack: boolean; utilityOnly: boolean };

function auditPackTarget(
  value: unknown,
  menu: BundledTenantMenu,
  packSlugs: ReadonlySet<string>,
  depth: number,
): TargetReachability {
  const target = objectRecord(value);
  if (!target) return { valid: false, reachesPack: false, utilityOnly: false };
  if (target.kind === 'utility') {
    return { valid: nonEmptyString(target.utility), reachesPack: false, utilityOnly: true };
  }
  if (target.kind === 'item' && nonEmptyString(target.itemSlug)) {
    const valid = menu.items.some((item) => item.id === target.itemSlug);
    return { valid, reachesPack: valid && packSlugs.has(target.itemSlug), utilityOnly: false };
  }
  if (target.kind === 'category' && nonEmptyString(target.categoryId)) {
    const category = menu.categories.find((candidate) => candidate.title === target.categoryId);
    const reachesPack = category !== undefined && menu.items.some(
      (item) => item.category === category.id && packSlugs.has(item.id),
    );
    return { valid: category !== undefined, reachesPack, utilityOnly: false };
  }
  if (target.kind !== 'group' || depth > 0 || !Array.isArray(target.nodes)) {
    return { valid: false, reachesPack: false, utilityOnly: false };
  }
  const children = target.nodes.map((node) => auditPackNode(node, menu, packSlugs, depth + 1));
  const validChildren = children.filter((child) => child.valid);
  const nonUtility = validChildren.filter((child) => !child.utilityOnly);
  return {
    valid: validChildren.length > 0,
    reachesPack: nonUtility.length > 0 && nonUtility.every((child) => child.reachesPack),
    utilityOnly: validChildren.length > 0 && validChildren.every((child) => child.utilityOnly),
  };
}

function auditPackNode(
  value: unknown,
  menu: BundledTenantMenu,
  packSlugs: ReadonlySet<string>,
  depth = 0,
): TargetReachability {
  const node = objectRecord(value);
  if (!node || !nonEmptyString(node.id) || !nonEmptyString(node.label)) {
    return { valid: false, reachesPack: false, utilityOnly: false };
  }
  return auditPackTarget(node.target, menu, packSlugs, depth);
}

function validatePackFlow(config: unknown, menu: BundledTenantMenu, problems: string[]): void {
  const kiosk = objectRecord(config);
  if (kiosk?.family !== 'pack') return;
  const packs = new Set(menu.items.filter((item) => item.packSize !== undefined).map((item) => item.id));
  if (packs.size === 0) {
    problems.push('brand.json: kiosk.family is "pack", but packs.json defines no usable pack.');
    return;
  }
  const nodes = objectRecord(kiosk.entry)?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return;
  const targets = nodes.map((node) => auditPackNode(node, menu, packs));
  const dead = targets.flatMap((target, index) => (
    target.valid && !target.utilityOnly && !target.reachesPack ? [index + 1] : []
  ));
  if (dead.length > 0) {
    problems.push(`brand.json: kiosk pack flow entry tile${dead.length === 1 ? '' : 's'} ${dead.join(', ')} cannot reach an item from packs.json.`);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateModifierChoice(itemSlug: string, groupId: string, value: unknown, problems: string[]): string | null {
  const choice = objectRecord(value);
  if (!choice || !nonEmptyString(choice.id) || !nonEmptyString(choice.name)
    || !Number.isInteger(choice.priceDeltaCents) || Number(choice.priceDeltaCents) < 0) {
    problems.push(`modifiers.json: "${itemSlug}" group "${groupId}" has an invalid choice.`);
    return null;
  }
  return choice.id;
}

function validateModifierGroupShape(itemSlug: string, value: unknown, problems: string[]): Record<string, unknown> | null {
  const group = objectRecord(value);
  if (!group || !nonEmptyString(group.id) || !nonEmptyString(group.name)
    || (group.select !== 'single' && group.select !== 'multi')
    || typeof group.required !== 'boolean' || !Number.isInteger(group.maxChoices)
    || Number(group.maxChoices) < 1 || !Array.isArray(group.choices) || group.choices.length === 0) {
    problems.push(`modifiers.json: "${itemSlug}" has an invalid option group.`);
    return null;
  }
  if (group.select === 'single' && group.maxChoices !== 1) {
    problems.push(`modifiers.json: "${itemSlug}" group "${group.id}" must set maxChoices to 1 for single select.`);
  }
  return group;
}

function validateModifierGroups(itemSlug: string, groups: unknown[], problems: string[]): void {
  const choicesByGroup = new Map<string, Set<string>>();
  const allChoiceIds = new Set<string>();
  const validGroups: Record<string, unknown>[] = [];
  for (const value of groups) {
    const group = validateModifierGroupShape(itemSlug, value, problems);
    if (!group || !nonEmptyString(group.id) || !Array.isArray(group.choices)) continue;
    if (choicesByGroup.has(group.id)) problems.push(`modifiers.json: "${itemSlug}" repeats group id "${group.id}".`);
    const choiceIds = new Set<string>();
    for (const choice of group.choices) {
      const choiceId = validateModifierChoice(itemSlug, group.id, choice, problems);
      if (choiceId && allChoiceIds.has(choiceId)) problems.push(`modifiers.json: "${itemSlug}" repeats choice id "${choiceId}".`);
      if (choiceId) {
        choiceIds.add(choiceId);
        allChoiceIds.add(choiceId);
      }
    }
    choicesByGroup.set(group.id, choiceIds);
    validGroups.push(group);
  }
  for (const group of validGroups) {
    if (group.dependsOn === undefined) continue;
    const dependency = objectRecord(group.dependsOn);
    const choiceIds = dependency && Array.isArray(dependency.choiceIds) ? dependency.choiceIds : [];
    const source = dependency && nonEmptyString(dependency.groupId) ? choicesByGroup.get(dependency.groupId) : undefined;
    if (!dependency || !source || choiceIds.length === 0 || choiceIds.some((id) => !nonEmptyString(id) || !source.has(id))) {
      problems.push(`modifiers.json: "${itemSlug}" group "${String(group.id)}" has an invalid dependency.`);
    }
  }
}

function webpSlugs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith('.webp'))
    .map((file) => file.replace(/\.webp$/, '')).sort();
}

function validateMenuAssets(dir: string, menu: BundledTenantMenu, problems: string[]): void {
  const imageDir = join(dir, 'assets', 'menu');
  const actual = new Set(webpSlugs(imageDir));
  const expected = new Set(menu.items.map((item) => item.id));
  for (const item of menu.items) {
    if (!actual.has(item.id)) problems.push(`assets/menu/${item.id}.webp is required by menu.csv.`);
  }
  for (const item of actual) {
    if (!expected.has(item)) problems.push(`assets/menu/${item}.webp has no row in menu.csv.`);
  }
}

function validateCustomerShellAssets(dir: string, problems: string[]): void {
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
  if (!existsSync(join(dir, 'assets', 'logo.svg')) && !existsSync(join(dir, 'assets', 'logo.png'))) {
    problems.push('assets/logo.svg or assets/logo.png is required to apply a tenant.');
  }
}

function syncDirectory(from: string, to: string, extensions: readonly string[]): number {
  mkdirSync(to, { recursive: true });
  const sources = existsSync(from)
    ? readdirSync(from).filter((file) => extensions.some((extension) => file.endsWith(extension)))
    : [];
  const sourceSet = new Set(sources);
  for (const file of readdirSync(to)) {
    if (extensions.some((extension) => file.endsWith(extension)) && !sourceSet.has(file)) unlinkSync(join(to, file));
  }
  for (const file of sources) copyFileSync(join(from, file), join(to, file));
  return sources.length;
}

function mediaIdentifier(slug: string): string {
  return `menu${slug.split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('')}`;
}

function renderMenuMedia(slugs: readonly string[]): string {
  const imports = slugs.map((slug) => `import ${mediaIdentifier(slug)} from '../../assets/menu/${slug}.webp';`);
  const entries = slugs.map((slug) => `  '${slug}': ${mediaIdentifier(slug)},`);
  return `/** GENERATED by \`pnpm onboard --tenant <slug> --apply\`. */
${imports.join('\n')}

export const TENANT_MENU_MEDIA: Readonly<Record<string, number>> = {
${entries.join('\n')}
};
`;
}

function writeWebManifest(brand: BrandFile, target: string): void {
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

function applyAppBundles(dir: string, brand: BrandFile, menu: BundledTenantMenu): void {
  const root = join(process.cwd(), 'apps', 'customer');
  const kioskRoot = join(process.cwd(), 'apps', 'kiosk');
  const tenantTarget = join(root, 'src', 'tenant');
  const kioskTenantTarget = join(kioskRoot, 'src', 'tenant');
  const menuJson = `${JSON.stringify(menu, null, 2)}\n`;
  const menuMedia = renderMenuMedia(menu.items.map((item) => item.id));
  writeFileSync(join(tenantTarget, 'menu.json'), menuJson);
  writeFileSync(join(kioskTenantTarget, 'menu.json'), menuJson);
  writeFileSync(join(tenantTarget, 'menu-media.ts'), menuMedia);
  writeFileSync(join(kioskTenantTarget, 'menu-media.ts'), menuMedia);
  const assets = join(dir, 'assets');
  syncDirectory(join(assets, 'menu'), join(root, 'assets', 'menu'), ['.webp', '.normalized.json']);
  syncDirectory(join(assets, 'menu'), join(kioskRoot, 'assets', 'menu'), ['.webp', '.normalized.json']);
  syncDirectory(join(assets, 'gift'), join(root, 'assets', 'gift'), ['.webp', '.png']);
  syncDirectory(join(assets, 'hero'), join(root, 'assets', 'hero'), ['.webp', '.png', '.mp4']);
  syncDirectory(join(assets, 'rewards'), join(root, 'assets', 'rewards'), ['.webp', '.png']);
  const generated = join(dir, 'app-store', 'generated');
  copyFileSync(join(generated, 'splash-logo.png'), join(root, 'assets', 'brand', 'logo.png'));
  copyFileSync(join(generated, 'icon.png'), join(root, 'assets', 'images', 'icon.png'));
  copyFileSync(join(generated, 'android-foreground.png'), join(root, 'assets', 'images', 'android-icon-foreground.png'));
  copyFileSync(join(generated, 'android-background.png'), join(root, 'assets', 'images', 'android-icon-background.png'));
  copyFileSync(join(generated, 'android-monochrome.png'), join(root, 'assets', 'images', 'android-icon-monochrome.png'));
  copyFileSync(join(generated, 'favicon.png'), join(root, 'assets', 'images', 'favicon.png'));
  copyFileSync(join(generated, 'android-foreground.png'), join(root, 'assets', 'expo.icon', 'Assets', 'mark.png'));
  writeExpoIconConfig(brand.tokens.surface, join(root, 'assets', 'expo.icon', 'icon.json'));
  copyFileSync(join(generated, 'icon.png'), join(root, 'public', 'icon.png'));
  copyFileSync(join(generated, 'icon-180.png'), join(root, 'public', 'icon-180.png'));
  writeWebManifest(brand, join(root, 'public', 'manifest.webmanifest'));
  applyKioskArtwork(generated, brand.tokens.surface);
}

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

function applyKioskArtwork(generated: string, surface: unknown): void {
  const root = join(process.cwd(), 'apps', 'kiosk');
  const images = join(root, 'assets', 'images');
  const brand = join(root, 'assets', 'brand');
  const expoIcon = join(root, 'assets', 'expo.icon');
  const expoIconAssets = join(expoIcon, 'Assets');
  mkdirSync(images, { recursive: true });
  mkdirSync(brand, { recursive: true });
  mkdirSync(expoIconAssets, { recursive: true });
  copyFileSync(join(generated, 'icon.png'), join(images, 'icon.png'));
  copyFileSync(join(generated, 'android-foreground.png'), join(images, 'android-icon-foreground.png'));
  copyFileSync(join(generated, 'android-background.png'), join(images, 'android-icon-background.png'));
  copyFileSync(join(generated, 'android-monochrome.png'), join(images, 'android-icon-monochrome.png'));
  copyFileSync(join(generated, 'favicon.png'), join(images, 'favicon.png'));
  copyFileSync(join(generated, 'splash-logo.png'), join(brand, 'logo.png'));
  copyFileSync(join(generated, 'android-foreground.png'), join(expoIconAssets, 'mark.png'));
  writeExpoIconConfig(surface, join(expoIcon, 'icon.json'));
}

/**
 * Copies the tenant's seated cut-outs into the app and regenerates the static
 * import map.
 *
 * Deliberately quiet when a tenant has none: the shelf that consumes these
 * degrades to however many exist, so a brand with no glass renders is a valid
 * brand and not a failed onboarding.
 */
function applyProductCutouts(dir: string): string {
  const from = join(dir, 'assets', 'products');
  const to = join(process.cwd(), 'apps', 'customer', 'assets', 'products');
  const generated = join(process.cwd(), 'apps', 'customer', 'src', 'tenant', 'product-media.ts');

  const seated = existsSync(from)
    ? readdirSync(from)
        .filter((file) => file.endsWith('.webp'))
        .map((file) => file.replace(/\.webp$/, ''))
        .sort()
    : [];

  syncDirectory(from, to, ['.webp']);

  const identifier = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const imports = seated.map((n) => `import ${identifier(n)} from '../../assets/products/${n}.webp';`);
  const entries = seated.map((n) => `  '${n}': ${identifier(n)},`);

  writeFileSync(
    generated,
    `/**
 * The product cut-outs this build ships, for this tenant.
 *
 * GENERATED by \`pnpm onboard --tenant <slug> --apply\` from
 * \`tenants/<slug>/assets/products/\`. Checked in for the same reason
 * \`brand.json\` is: Metro cannot require a path chosen at runtime, so
 * onboarding materialises the choice. Editing this by hand puts it out of step
 * with the tenant folder.
 *
 * A slug missing from this map is not an error. \`resolveProductMedia\` returns
 * null and the shelf is one row shorter -- a tenant part-way through shooting
 * its menu still boots, which is the one place this path deliberately differs
 * from the menu photographs.
 */
import { EMPTY_PRODUCT_MEDIA, type ProductMediaCatalog } from '@platform/domain';

${imports.join('\n')}${imports.length > 0 ? '\n' : ''}
/** slug -> Metro module id. The one place a cut-out asset is named. */
export const BUNDLED_CUTOUTS: Readonly<Record<string, number>> = {
${entries.join('\n')}${entries.length > 0 ? '\n' : ''}};

/**
 * The catalog the resolver reads.
 *
 * \`remote\` stays empty until \`menu_items.image_url\` has a writer. Nothing
 * about this file or its callers changes when it does -- that is the whole
 * reason the resolver returns a reference rather than a module id.
 */
export const TENANT_PRODUCT_MEDIA: ProductMediaCatalog = {
  bundled: new Set(Object.keys(BUNDLED_CUTOUTS)),
  remote: EMPTY_PRODUCT_MEDIA.remote,
};
`,
  );

  return seated.length > 0
    ? `${seated.length} copied into apps/customer, import map regenerated`
    : 'none in this tenant\'s assets/products (the shelf simply shows fewer rows)';
}

run().catch((error) => {
  console.error('onboard failed:', error?.message ?? error);
  process.exit(1);
});
