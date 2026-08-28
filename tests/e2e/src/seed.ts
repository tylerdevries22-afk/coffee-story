/**
 * Seeding beyond what `pnpm onboard --tenant coffee-story` already did (the
 * CI job runs the REAL onboarding against the stack — proving that path is
 * itself part of this suite): staff accounts and a second tenant for the
 * isolation scenario.
 */
import { serviceClient, sql, uniqueEmail } from './stack.ts';

export type SeededBrand = { brandId: string; locationId: string };

/** The tenant onboarding seeded; fails loudly if the CI step was skipped. */
export async function onboardedBrand(slug = 'coffee-story'): Promise<SeededBrand> {
  const brand = await sql<{ id: string }>(`select id from public.brands where slug = $1`, [slug]);
  const brandId = brand.rows[0]?.id;
  if (!brandId) throw new Error(`Brand "${slug}" is not seeded — run \`pnpm onboard --tenant ${slug}\` against the stack first.`);
  const location = await sql<{ id: string }>(
    `select id from public.locations where brand_id = $1 order by created_at limit 1`,
    [brandId],
  );
  const locationId = location.rows[0]?.id;
  if (!locationId) throw new Error(`Brand "${slug}" has no location.`);
  return { brandId, locationId };
}

export type StaffAccount = { email: string; password: string; userId: string };

/** A confirmed customer account that exercises hosted Auth without external email delivery. */
export async function createGuestAccount(): Promise<StaffAccount> {
  const email = uniqueEmail('guest');
  const password = `e2e-Pass-${Math.random().toString(36).slice(2, 10)}`;
  const created = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'E2E Guest', brand_slug: 'coffee-story' },
  });
  if (created.error || !created.data.user) throw new Error(`createGuestUser: ${created.error?.message}`);
  return { email, password, userId: created.data.user.id };
}

/** A password staff account whose next token carries staff claims. */
export async function createStaffAccount(
  brand: SeededBrand,
  role: 'location_manager' | 'brand_owner',
): Promise<StaffAccount> {
  const service = serviceClient();
  const email = uniqueEmail('staff');
  const password = `e2e-Pass-${Math.random().toString(36).slice(2, 10)}`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'E2E Staff' },
  });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  await sql(
    `insert into public.brand_users (user_id, brand_id, role, location_ids) values ($1, $2, $3, $4)`,
    [created.data.user.id, brand.brandId, role, role === 'location_manager' ? [brand.locationId] : []],
  );
  return { email, password, userId: created.data.user.id };
}

/** A second tenant with one paid order, for the isolation scenario. */
export async function seedRivalBrandOrder(): Promise<{ orderId: string }> {
  const brand = await sql<{ id: string }>(
    `insert into public.brands (slug, name) values ('e2e-rival', 'Rival Roastery')
     on conflict (slug) do update set name = excluded.name returning id`,
  );
  const brandId = brand.rows[0]!.id;
  const location = await sql<{ id: string }>(
    `insert into public.locations (brand_id, name, timezone)
     select $1, 'Rival Main', 'America/Denver'
     where not exists (select 1 from public.locations where brand_id = $1)
     returning id`,
    [brandId],
  );
  const locationId = location.rows[0]?.id
    ?? (await sql<{ id: string }>(`select id from public.locations where brand_id = $1 limit 1`, [brandId])).rows[0]!.id;
  const order = await sql<{ id: string }>(
    `insert into public.orders (brand_id, location_id, status, total_cents, totals)
     values ($1, $2, 'created', 640, '{"lines":[{"name":"Rival Latte","quantity":1,"unit_price_cents":640,"options":[]}]}'::jsonb)
     returning id`,
    [brandId, locationId],
  );
  const orderId = order.rows[0]!.id;
  await sql(
    `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'paid', 'system')`,
    [brandId, orderId],
  );
  return { orderId };
}
