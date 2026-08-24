/**
 * Connection to the Supabase stack under test. Locally this container has no
 * Docker daemon, so the suite SKIPS unless the env names a stack — in CI,
 * `supabase start` provides one and exports these before the run:
 *
 *   SUPABASE_TEST_URL                the API URL (http://127.0.0.1:54321)
 *   SUPABASE_TEST_ANON_KEY           anon key
 *   SUPABASE_TEST_SERVICE_ROLE_KEY   service-role key
 *   SUPABASE_TEST_DB_URL             direct Postgres URL (SQL-level asserts)
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

export const stack = {
  url: process.env.SUPABASE_TEST_URL ?? '',
  anonKey: process.env.SUPABASE_TEST_ANON_KEY ?? '',
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '',
  dbUrl: process.env.SUPABASE_TEST_DB_URL ?? '',
};

export const stackConfigured = Boolean(stack.url && stack.anonKey && stack.serviceRoleKey && stack.dbUrl);

/** Every suite calls this in `describe(..., { skip })` so `pnpm -r test` stays green without a stack. */
export const skipUnlessConfigured = stackConfigured
  ? false
  : 'no Supabase test stack (set SUPABASE_TEST_* — CI starts one with `supabase start`)';

export function serviceClient(): SupabaseClient {
  return createClient(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  return createClient(stack.url, stack.anonKey, { auth: { persistSession: false } });
}

/** A client whose PostgREST requests carry a real user's access token. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: stack.dbUrl });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

/**
 * Creates a confirmed user with a password, optional bootstrap metadata, and
 * returns a signed-in session whose token went through the claims hook.
 */
export async function createSignedInUser(options: {
  email?: string;
  userMetadata?: Record<string, unknown>;
  /** Rows to create BEFORE sign-in so the hook can see them. */
  before?: (userId: string) => Promise<void>;
}): Promise<{ userId: string; accessToken: string; claims: Record<string, unknown> }> {
  const service = serviceClient();
  const email = options.email ?? `test-${randomUUID()}@integration.local`;
  const password = `pw-${randomUUID()}`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: options.userMetadata,
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed: ${created.error?.message}`);
  }
  const userId = created.data.user.id;
  if (options.before) await options.before(userId);

  const anon = anonClient();
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    throw new Error(`signInWithPassword failed: ${signedIn.error?.message}`);
  }
  const accessToken = signedIn.data.session.access_token;
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8'));
  return { userId, accessToken, claims: payload.app_metadata ?? {} };
}

/**
 * Seeds a brand + location and returns their ids.
 *
 * Re-seeding a slug gives a genuinely clean brand, not a brand with another
 * run's rows still attached. Without this the suite passed once on a fresh
 * database and failed on a second run -- menus, orders and customers piled up,
 * so a test asserting "one category" found two. That made the whole suite
 * valid only against a throwaway CI database, which is the same as saying
 * nobody could re-run it and believe the result.
 *
 * The brand row itself is kept rather than deleted: tests hold ids across
 * `before` hooks, and cascading the brand away would pull the location out
 * from under them.
 */
export async function seedBrand(slug: string): Promise<{ brandId: string; locationId: string }> {
  const brand = await sql<{ id: string }>(
    `insert into public.brands (slug, name) values ($1, $2)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [slug, `Test ${slug}`],
  );
  const brandId = brand.rows[0]!.id;

  // Dependent rows, most-dependent first. Everything else cascades from these.
  for (const table of [
    'order_events', 'platform_fees', 'orders',
    'loyalty_events', 'loyalty_accounts', 'stored_value_ledger', 'referrals', 'customers',
    'prep_batches', 'recipes', 'crew_task_completions', 'crew_tasks', 'shifts', 'devices',
    'campaigns', 'drops', 'menu_items', 'menu_categories', 'menus',
  ]) {
    await sql(`delete from public.${table} where brand_id = $1`, [brandId]).catch(() => undefined);
  }

  // square_connections is unique per location and referenced back by the
  // location row, so the reference has to be cleared before the row can go.
  // It is not covered by the loop above for that reason.
  await sql(
    `update public.locations set square_connection_id = null where brand_id = $1`,
    [brandId],
  ).catch(() => undefined);
  await sql(`delete from public.square_connections where brand_id = $1`, [brandId])
    .catch(() => undefined);
  const location = await sql<{ id: string }>(
    `insert into public.locations (brand_id, name, timezone)
     select $1, 'Main', 'America/Denver'
     where not exists (select 1 from public.locations where brand_id = $1 and name = 'Main')
     returning id`,
    [brandId],
  );
  const locationId = location.rows[0]?.id
    ?? (await sql<{ id: string }>(`select id from public.locations where brand_id = $1 and name = 'Main'`, [brandId])).rows[0]!.id;
  return { brandId, locationId };
}

/**
 * Runs statements as a signed-in principal, the way PostgREST does: role
 * `authenticated` with request.jwt.claims set for the transaction.
 *
 * One client for the whole transaction, because `set local` only lasts as long
 * as the transaction that set it -- and the per-call client in `sql()` opens a
 * new connection each time, which silently drops the claims. Always rolled
 * back, so an assertion never leaves rows behind for the next one.
 */
export async function asPrincipal<T extends pg.QueryResultRow = pg.QueryResultRow>(
  claims: Record<string, unknown>,
  statement: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: stack.dbUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'authenticated', ...claims }),
    ]);
    return await client.query<T>(statement, params);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}
