'use server';

/**
 * Import a menu from a CSV paste, so a new tenant fills its catalog in one step
 * instead of an engineer running the seed script. The CSV is the same contract
 * the onboarding pipeline reads (slug,name,category,description,base_price_cents,
 * sizes), parsed by the shared, unit-tested parser so the two paths cannot
 * drift.
 *
 * The write runs as the signed-in owner: menus/menu_categories/menu_items all
 * admit is_brand_owner on insert, so RLS is the authority and no service role is
 * involved. Rows upsert on their natural keys, so a re-import is idempotent. In
 * the demo (no database) the parse still runs and reports what it would import,
 * so the flow is exercisable with no infrastructure.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parseMenuCsv } from '@platform/schema';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import { planImportCategories } from '@/lib/menu-import-categories';
import { selectedOrganizationId } from '@/lib/workspace-scope';
import { mayMutateSelectedOrganization } from '@/lib/workspace-mutation';

function fail(message: string): never {
  redirect(`/menu/import?error=${encodeURIComponent(message)}`);
}

// A single paste seeds one brand's catalog, not a bulk data load; a sane ceiling
// keeps one import from issuing an unbounded upsert (and one mistaken paste from
// trying to write tens of thousands of rows under the owner's RLS in one call).
const MAX_MENU_ROWS = 500;

export async function importMenuAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) redirect('/menu?imported=denied');

  const csv = String(formData.get('csv') ?? '');
  const { rows, errors } = parseMenuCsv(csv);
  if (errors.length > 0) fail(errors[0] ?? 'The menu CSV could not be parsed.');
  if (rows.length === 0) fail('The CSV has a header but no menu rows.');
  if (rows.length > MAX_MENU_ROWS) {
    fail(`This import has ${rows.length} rows; a single menu import is limited to ${MAX_MENU_ROWS}. Split it into smaller files.`);
  }

  const brandId = await selectedOrganizationId(session);
  if (!mayMutateSelectedOrganization(session.brandId, brandId)) {
    fail('Cross-organization menu imports require the audited support workflow.');
  }

  if (!isConfigured()) {
    // Demo: nothing to write, but the parse is real -- report what would land.
    redirect(`/menu?imported=${rows.length}&preview=1`);
  }

  const client = await serverClient();
  if (!client) fail('This deployment is not connected to Supabase.');

  const menu = await client
    .from('menus')
    .upsert({ brand_id: brandId, name: 'Menu', is_published: true }, { onConflict: 'brand_id,name' })
    .select('id')
    .single<{ id: string }>();
  if (menu.error || !menu.data) fail('Could not open the brand menu.');
  const menuId = menu.data.id;

  // Categories first: items carry a NOT NULL category_id, so every category the
  // rows name has to exist before the items reference it.
  const categoryTitles = [...new Set(rows.map((row) => row.category))];
  const existing = await client.from('menu_categories').select('id,title,slug')
    .eq('menu_id', menuId).returns<{ id: string; title: string; slug: string }[]>();
  if (existing.error) fail('Could not read the menu categories.');
  const planned = planImportCategories(categoryTitles, existing.data ?? []);
  const categories = planned.length > 0
    ? await client.from('menu_categories').insert(planned.map((category) => ({
      brand_id: brandId, menu_id: menuId, slug: category.slug,
      title: category.title, sort_order: category.sortOrder,
    }))).select('id,title').returns<{ id: string; title: string }[]>()
    : { data: [], error: null };
  if (categories.error) fail('Could not create the menu categories.');
  const categoryId = new Map(
    [...(existing.data ?? []), ...(categories.data ?? [])].map((row) => [row.title, row.id]),
  );

  const itemRows = rows.map((row, index) => ({
    brand_id: brandId, menu_id: menuId, category_id: categoryId.get(row.category) ?? '',
    slug: row.slug, name: row.name, description: row.description,
    base_price_cents: row.basePriceCents, sizes: row.sizes, sort_order: index,
  }));
  const items = await client.from('menu_items').upsert(itemRows, { onConflict: 'menu_id,slug' });
  if (items.error) fail('Could not import the menu items.');

  revalidatePath('/menu');
  redirect(`/menu?imported=${rows.length}`);
}
