/**
 * Tenant onboarding: `pnpm onboard --tenant <slug>` (add `--apply` to point
 * the customer app's bundled tenant at this slug).
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
 *   5. With --apply: copy brand.json into apps/customer/src/tenant/ so the
 *      next build ships this tenant (the drift test pins the copy).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseMenuCsv } from '@platform/schema';

type BrandFile = {
  identity: { slug: string; name: string; bundleId: string; scheme: string; easProjectId: string };
  tokens: Record<string, unknown> & { primary?: string; surface?: string };
  copy: Record<string, string>;
  features: Record<string, boolean>;
  fees: { feeBps: number; feeBpsTier2: number; tierThresholdCents: number };
  business: Record<string, string>;
  /** Sales-tax authorities the order API charges. Absent = no tax. */
  tax?: { jurisdictions: { id: string; label: string; rate: number }[] };
  /** What points buy, served by /api/loyalty/redeem. */
  loyalty?: { rewards: { slug: string; name: string; points_cost: number }[] };
  location: {
    name: string;
    address: Record<string, string>;
    timezone: string;
    hours: Record<string, { open: string; close: string }[]>;
  };
};

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const slug = argValue('--tenant');
const apply = process.argv.includes('--apply');
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('Usage: pnpm onboard --tenant <slug> [--apply]');
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
    }
  }
  if (problems.length > 0) {
    console.error(`tenants/${slug} does not validate:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`1. validated brand.json${menu.rows.length ? ` and menu.csv (${menu.rows.length} items)` : ' (no menu.csv)'}`);

  // 2. Database ------------------------------------------------------------
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
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
            ...(brand.loyalty ? { loyalty: brand.loyalty } : {}),
          },
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();
    if (brandError) throw brandError;

    const { data: existingLocation } = await db
      .from('locations').select('id').eq('brand_id', brandRow.id).eq('name', brand.location.name).maybeSingle();
    let locationId = existingLocation?.id as string | undefined;
    if (!locationId) {
      const { data: created, error } = await db
        .from('locations')
        .insert({
          brand_id: brandRow.id,
          name: brand.location.name,
          address: brand.location.address,
          hours: brand.location.hours,
          timezone: brand.location.timezone,
        })
        .select('id')
        .single();
      if (error) throw error;
      locationId = created.id;
    }

    if (menu.rows.length > 0) {
      const { data: existingMenu } = await db.from('menus').select('id').eq('brand_id', brandRow.id).limit(1).maybeSingle();
      let menuId = existingMenu?.id as string | undefined;
      if (!menuId) {
        const { data: created, error } = await db
          .from('menus').insert({ brand_id: brandRow.id, name: 'Menu', is_published: true }).select('id').single();
        if (error) throw error;
        menuId = created.id;
      }
      const categories = [...new Set(menu.rows.map((row) => row.category))];
      const categoryIds = new Map<string, string>();
      for (const [index, title] of categories.entries()) {
        const { data: existing } = await db
          .from('menu_categories').select('id').eq('menu_id', menuId).eq('title', title).maybeSingle();
        if (existing) { categoryIds.set(title, existing.id); continue; }
        const { data: created, error } = await db
          .from('menu_categories')
          .insert({ brand_id: brandRow.id, menu_id: menuId, title, sort_order: index })
          .select('id').single();
        if (error) throw error;
        categoryIds.set(title, created.id);
      }
      for (const [index, row] of menu.rows.entries()) {
        const { error } = await db.from('menu_items').upsert(
          {
            brand_id: brandRow.id,
            menu_id: menuId,
            category_id: categoryIds.get(row.category)!,
            slug: row.slug,
            name: row.name,
            description: row.description,
            base_price_cents: row.basePriceCents,
            sizes: row.sizes,
            modifiers: modifiersBySlug[row.slug] ?? [],
            sort_order: index,
          },
          { onConflict: 'menu_id,slug' },
        );
        if (error) throw error;
      }
    }
    console.log(`2. database: brand + location + ${menu.rows.length} menu items upserted`);
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
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: primary } })
      .png().toFile(join(generatedDir, 'android-background.png'));
    console.log(`3. artwork: icon, splash logo, adaptive art -> tenants/${slug}/app-store/generated/`);
  } else {
    console.log(`3. artwork: skipped (add tenants/${slug}/assets/logo.svg or logo.png to generate icons and splash)`);
  }

  // 4. Listing material ----------------------------------------------------
  const appStoreDir = join(tenantDir, 'app-store');
  mkdirSync(appStoreDir, { recursive: true });
  const pointsName = brand.copy.pointsName ?? 'Points';
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

Fill in before submission: support URL (${brand.business.website ?? ''}),
privacy policy URL, and the marketing URL.
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

  // 5. Apply to the customer app -------------------------------------------
  if (apply) {
    copyFileSync(brandPath, join(process.cwd(), 'apps', 'customer', 'src', 'tenant', 'brand.json'));
    console.log(`5. applied: apps/customer now bundles ${slug} (build with TENANT=${slug})`);
  } else {
    console.log(`5. not applied: pass --apply to point apps/customer at this tenant`);
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

  mkdirSync(to, { recursive: true });
  for (const name of seated) copyFileSync(join(from, `${name}.webp`), join(to, `${name}.webp`));

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
