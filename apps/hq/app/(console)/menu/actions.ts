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
import { slugify } from '@platform/domain';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import { selectedOrgId } from '@/lib/workspace-location';
import { authorizeOrganization } from '@/lib/workspace-scope';

function fail(message: string): never {
  redirect(`/menu/import?error=${encodeURIComponent(message)}`);
}

export async function importMenuAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) redirect('/menu?imported=denied');

  const csv = String(formData.get('csv') ?? '');
  const { rows, errors } = parseMenuCsv(csv);
  if (errors.length > 0) fail(errors[0] ?? 'The menu CSV could not be parsed.');
  if (rows.length === 0) fail('The CSV has a header but no menu rows.');

  if (!isConfigured()) {
    // Demo: nothing to write, but the parse is real -- report what would land.
    redirect(`/menu?imported=${rows.length}&preview=1`);
  }

  const cookieOrg = await selectedOrgId();
  const brandId = (cookieOrg ? await authorizeOrganization(session, cookieOrg) : null) ?? session.brandId;

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
  const categoryRows = categoryTitles.map((title, index) => ({
    brand_id: brandId, menu_id: menuId, slug: slugify(title, 64) || `category-${index}`, title, sort_order: index,
  }));
  const categories = await client
    .from('menu_categories')
    .upsert(categoryRows, { onConflict: 'menu_id,title' })
    .select('id,title')
    .returns<{ id: string; title: string }[]>();
  if (categories.error) fail('Could not create the menu categories.');
  const categoryId = new Map((categories.data ?? []).map((row) => [row.title, row.id]));

  const itemRows = rows.map((row, index) => ({
    brand_id: brandId, menu_id: menuId, category_id: categoryId.get(row.category),
    slug: row.slug, name: row.name, description: row.description,
    base_price_cents: row.basePriceCents, sizes: row.sizes, sort_order: index,
  }));
  const items = await client.from('menu_items').upsert(itemRows, { onConflict: 'menu_id,slug' });
  if (items.error) fail('Could not import the menu items.');

  revalidatePath('/menu');
  redirect(`/menu?imported=${rows.length}`);
}
