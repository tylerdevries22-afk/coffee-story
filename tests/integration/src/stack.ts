/**
 * Connection to the Supabase stack under test. The suite skips unless the
 * environment names an isolated database; CI provisions a disposable hosted
 * Supabase branch and exports these values before the run:
 *
 *   SUPABASE_TEST_URL                the API URL (http://127.0.0.1:54321)
 *   SUPABASE_TEST_ANON_KEY           anon key
 *   SUPABASE_TEST_SERVICE_ROLE_KEY   service-role key
 *   SUPABASE_TEST_DB_URL             direct Postgres URL (SQL-level asserts)
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const DATABASE_CONNECT_TIMEOUT_MS = 10_000;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const HTTP_MAX_ATTEMPTS = 2;

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let latestError: unknown;
  for (let attempt = 1; attempt <= HTTP_MAX_ATTEMPTS; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    try {
      const response = await fetch(input, { ...init, signal });
      if (attempt === HTTP_MAX_ATTEMPTS || !retryableStatus(response.status)) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      latestError = error;
      if (attempt === HTTP_MAX_ATTEMPTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw latestError instanceof Error ? latestError : new Error('Supabase request failed');
}

const supabaseOptions = {
  auth: { persistSession: false },
  global: { fetch: resilientFetch },
} as const;

function databaseClient(): pg.Client {
  return new pg.Client({
    connectionString: stack.dbUrl,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
    query_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
  });
}

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
  : 'no hosted Supabase test branch (set SUPABASE_TEST_*; CI provisions one automatically)';

export function serviceClient(): SupabaseClient {
  return createClient(stack.url, stack.serviceRoleKey, supabaseOptions);
}

export function anonClient(): SupabaseClient {
  return createClient(stack.url, stack.anonKey, supabaseOptions);
}

/** A client whose PostgREST requests carry a real user's access token. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false },
    global: { fetch: resilientFetch, headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = databaseClient();
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
  let userId = created.data.user?.id;
  if (!userId && created.error?.message.toLowerCase().includes('registered')) {
    userId = (await sql<{ id: string }>(
      'select id from auth.users where lower(email) = lower($1) order by created_at desc limit 1',
      [email],
    )).rows[0]?.id;
  }
  if (!userId) throw new Error(`createUser failed: ${created.error?.message}`);
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
/**
 * Install a module and take it live, draft -> validating -> active.
 *
 * The only route in. 20260903170000 revoked insert and update on
 * public.module_installations and put a row trigger behind the revoke, so a
 * fixture cannot write the table directly even on the owner connection this
 * helper uses -- which is the point: an installation that skipped the
 * lifecycle would also skip module_installation_events, and a capability
 * granted with no audit row is not the state any tenant is ever really in.
 *
 * Lives here rather than in one suite because operations capability is now an
 * installation (20260903220000), so seeding it is no longer a column update
 * any suite can do inline.
 */
export async function activateModule(
  brandId: string,
  moduleKey: string,
  /**
   * Null is a legitimate actor: `installed_by` and the event's `actor` are
   * both nullable, and a fixture that seeds capability before it seeds people
   * has nobody honest to name. It also keeps the event trail clear of an
   * `on delete restrict` reference to a user the suite may delete.
   */
  actor: string | null = null,
  version = '1.0.0',
): Promise<string> {
  const created = await sql<{ create_module_installation: string }>(
    `select app.create_module_installation($1, $2, $3, null::jsonb, $4, $5)`,
    [brandId, moduleKey, version, actor, randomUUID()],
  );
  const installationId = created.rows[0]!.create_module_installation;
  for (const [state, revision] of [['validating', 1], ['active', 2]] as const) {
    await sql(
      `select app.set_module_installation_state($1, $2, $3, null::jsonb, $4, $5, $6)`,
      [installationId, brandId, state, revision, actor, randomUUID()],
    );
  }
  return installationId;
}

export async function seedBrand(slug: string): Promise<{ brandId: string; locationId: string }> {
  const client = databaseClient();
  await client.connect();
  await client.query('begin');
  try {
    const brand = await client.query<{ id: string }>(
      `insert into public.brands (slug, name) values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [slug, `Test ${slug}`],
    );
    const brandId = brand.rows[0]!.id;

    // Test reruns deliberately clear immutable release history. Restrict the
    // trigger bypass to this transaction and restore normal enforcement before
    // test fixtures are inserted. The hosted canary still exercises the real
    // trigger in every test assertion.
    await client.query('set local session_replication_role = replica');

    // Dependent rows, most-dependent first. One transaction and connection
    // keeps hosted preview branches fast and prevents pool exhaustion.
    for (const table of [
      // Installations decide capability now, so a reseeded brand has to lose
      // the ones a previous run activated -- otherwise a fixture that means to
      // be operations-disabled inherits an active module and passes for the
      // wrong reason. Events go first; `session_replication_role = replica`
      // above is what lets them, and it is the same bypass the release-history
      // clear already relies on.
      // site_module_overrides cascades off (brand_id, module_key) and the
      // events off the installation id, and neither cascade fires while
      // replication is 'replica' -- so both are named explicitly rather than
      // left to a trigger that is switched off.
      'site_module_overrides', 'module_installation_events', 'module_installations',
      'operation_operator_notifications', 'operation_staff_devices',
      'operation_action_receipts', 'operation_notification_outbox',
      'operation_issues', 'operation_step_responses', 'operation_occurrence_events',
      'operations_change_signals', 'operation_occurrences', 'operation_escalation_rules',
      'operation_schedules', 'operation_retention_policies',
      'training_competency_awards', 'training_competencies',
      'operation_task_steps', 'operation_task_templates',
      'catalog_release_private', 'catalog_publications', 'catalog_audit_events',
      'catalog_relations', 'catalog_resources', 'catalog_placements',
      'catalog_releases', 'catalog_nodes', 'catalogs',
      'content_media_versions',
      'training_quiz_attempts', 'training_lesson_progress', 'training_releases',
      'training_bootstrap_runs', 'availability_blockouts',
      'calendar_entry_assignments', 'calendar_entries',
      'workforce_role_assignments', 'workforce_profiles', 'workforce_roles',
      'order_events', 'platform_fees', 'orders',
      'loyalty_events', 'loyalty_accounts', 'stored_value_ledger', 'referrals', 'customers',
      'prep_batches', 'recipes', 'crew_task_completions', 'crew_tasks', 'shifts', 'devices',
      'campaigns', 'drops', 'menu_items', 'menu_categories', 'menus',
    ]) {
      await client.query(`delete from public.${table} where brand_id = $1`, [brandId]);
    }

    // square_connections is unique per location and referenced back by the
    // location row, so the reference has to be cleared before the row can go.
    await client.query(
      `update public.locations set square_connection_id = null where brand_id = $1`,
      [brandId],
    );
    await client.query(`delete from public.square_connections where brand_id = $1`, [brandId]);
    await client.query(`delete from public.locations where brand_id = $1`, [brandId]);
    await client.query('set local session_replication_role = origin');
    const location = await client.query<{ id: string }>(
      `insert into public.locations (brand_id, name, timezone)
       values ($1, 'Main', 'America/Denver') returning id`,
      [brandId],
    );
    const locationId = location.rows[0]!.id;
    await client.query('commit');
    return { brandId, locationId };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
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
  const client = databaseClient();
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
