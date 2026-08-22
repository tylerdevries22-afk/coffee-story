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

/** Seeds a brand + location and returns their ids. */
export async function seedBrand(slug: string): Promise<{ brandId: string; locationId: string }> {
  const brand = await sql<{ id: string }>(
    `insert into public.brands (slug, name) values ($1, $2)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [slug, `Test ${slug}`],
  );
  const brandId = brand.rows[0]!.id;
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
