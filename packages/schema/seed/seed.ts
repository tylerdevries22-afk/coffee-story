/**
 * Seeds a demo brand with two locations, a published menu, and a live drop.
 *
 * Idempotent: everything upserts on its natural key (brand slug, location
 * name, menu-item slug), so re-running refreshes rather than duplicates.
 *
 * Needs the server environment only:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * The service role bypasses RLS; this never runs from a client.
 *
 *   pnpm --filter @platform/schema seed
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('seed: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only; never ship the service key in an app).');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function run() {
  const { data: brand, error: brandError } = await db
    .from('brands')
    .upsert(
      {
        slug: 'demo-roastery',
        name: 'Demo Roastery',
        fee_bps: 300,
        fee_bps_tier2: 150,
        tier_threshold_cents: 2_000_000,
        drops: true,
        catering: true,
        delivery: false,
        multi_location: true,
        sms: false,
        stored_value: true,
        referrals: true,
        brand_config: {
          copy: { appName: 'Demo Roastery', pointsName: 'Beans' },
          tokens: { primary: '#2F2A26', accent: '#B08D57' },
        },
      },
      { onConflict: 'slug' },
    )
    .select()
    .single();
  if (brandError) throw brandError;
  console.log(`brand ${brand.slug} = ${brand.id}`);

  const locations = [] as { id: string; name: string }[];
  for (const loc of [
    { name: 'Downtown', address: { street: '100 Main St', city: 'Denver', region: 'CO', postal: '80202' } },
    { name: 'Uptown', address: { street: '2500 North Ave', city: 'Denver', region: 'CO', postal: '80205' } },
  ]) {
    const { data: existing } = await db
      .from('locations').select('id, name').eq('brand_id', brand.id).eq('name', loc.name).maybeSingle();
    const hours = {
      mon: [{ open: '08:00', close: '23:00' }], tue: [{ open: '08:00', close: '23:00' }],
      wed: [{ open: '08:00', close: '23:00' }], thu: [{ open: '08:00', close: '23:00' }],
      fri: [{ open: '08:00', close: '24:00' }], sat: [{ open: '08:00', close: '24:00' }],
      sun: [{ open: '08:00', close: '23:00' }],
    };
    if (existing) {
      locations.push(existing);
      continue;
    }
    const { data: created, error } = await db
      .from('locations')
      .insert({ brand_id: brand.id, name: loc.name, address: loc.address, hours, timezone: 'America/Denver' })
      .select('id, name')
      .single();
    if (error) throw error;
    locations.push(created);
  }
  console.log(`locations: ${locations.map((l) => l.name).join(', ')}`);

  // menus has no natural unique key: read-or-create the brand's first menu.
  let menuId: string;
  {
    const { data: existing } = await db.from('menus').select('id').eq('brand_id', brand.id).limit(1).maybeSingle();
    if (existing) {
      menuId = existing.id;
      await db.from('menus').update({ is_published: true }).eq('id', menuId);
    } else {
      const { data: created, error } = await db
        .from('menus').insert({ brand_id: brand.id, name: 'Menu', is_published: true }).select('id').single();
      if (error) throw error;
      menuId = created.id;
    }
  }

  const categories = [
    { title: 'Espresso', tagline: 'Pulled to order', sort_order: 0 },
    { title: 'Brew Bar', tagline: 'Slow and single-origin', sort_order: 1 },
    { title: 'Pastry', tagline: 'Baked this morning', sort_order: 2 },
  ];
  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    const { data: existing } = await db
      .from('menu_categories').select('id').eq('menu_id', menuId).eq('title', category.title).maybeSingle();
    if (existing) { categoryIds.set(category.title, existing.id); continue; }
    const { data: created, error } = await db
      .from('menu_categories').insert({ brand_id: brand.id, menu_id: menuId, ...category }).select('id').single();
    if (error) throw error;
    categoryIds.set(category.title, created.id);
  }

  const items = [
    { category: 'Espresso', slug: 'cortado', name: 'Cortado', base_price_cents: 450, sizes: [{ slug: '4', label: '4 oz', price_cents: 450 }] },
    { category: 'Espresso', slug: 'oat-latte-12', name: 'Oat Latte', base_price_cents: 550, sizes: [{ slug: '12', label: '12 oz', price_cents: 550 }, { slug: '16', label: '16 oz', price_cents: 625 }] },
    { category: 'Brew Bar', slug: 'v60-single', name: 'V60 Single Origin', base_price_cents: 600, sizes: [{ slug: '10', label: '10 oz', price_cents: 600 }] },
    { category: 'Pastry', slug: 'kouign-amann', name: 'Kouign-Amann', base_price_cents: 525, sizes: [] },
  ];
  let dropItemId: string | null = null;
  for (const item of items) {
    const { data: row, error } = await db
      .from('menu_items')
      .upsert(
        {
          brand_id: brand.id,
          menu_id: menuId,
          category_id: categoryIds.get(item.category)!,
          slug: item.slug,
          name: item.name,
          base_price_cents: item.base_price_cents,
          sizes: item.sizes,
          modifiers: [],
        },
        { onConflict: 'menu_id,slug' },
      )
      .select('id, slug')
      .single();
    if (error) throw error;
    if (row.slug === 'kouign-amann') dropItemId = row.id;
  }
  console.log(`menu ${menuId}: ${items.length} items across ${categories.length} categories`);

  if (dropItemId) {
    const { data: existingDrop } = await db
      .from('drops').select('id').eq('brand_id', brand.id).eq('item_id', dropItemId).maybeSingle();
    if (!existingDrop) {
      const now = Date.now();
      const { error } = await db.from('drops').insert({
        brand_id: brand.id,
        item_id: dropItemId,
        starts_at: new Date(now).toISOString(),
        ends_at: new Date(now + 3 * 24 * 3600_000).toISOString(),
        status: 'live',
      });
      if (error) throw error;
      console.log('drop: live for 3 days on kouign-amann');
    }
  }

  console.log('seed complete');
}

run().catch((error) => {
  console.error('seed failed:', error?.message ?? error);
  process.exit(1);
});
