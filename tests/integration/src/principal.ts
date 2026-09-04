import type pg from 'pg';

import { databaseClient } from './stack.ts';

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

/**
 * Several statements as one principal, in one transaction, then rolled back.
 *
 * `asPrincipal` runs a single statement, which cannot observe its own write:
 * PostgreSQL takes one snapshot per statement, so a data-modifying CTE's
 * effects are invisible to a sibling subquery in the same statement. A test
 * that needs to write and then read -- "creating a network enrols its creator"
 * -- was written as a CTE on the assumption that referencing it forced an
 * ordering, and asserted `null` against a function that was working correctly.
 *
 * Read-committed takes a fresh snapshot for each statement, so a later
 * statement in the same transaction does see an earlier one's uncommitted
 * write. That is the property this exposes. Verified on PostgreSQL 17.10:
 * the CTE form reports no membership row, two statements report
 * `franchisor_admin`, and the rollback leaves nothing behind either way.
 *
 * Returns every result, so a caller can assert on any step.
 */
export async function asPrincipalSequence<T extends pg.QueryResultRow = pg.QueryResultRow>(
  claims: Record<string, unknown>,
  statements: readonly { readonly text: string; readonly params?: unknown[] }[],
): Promise<pg.QueryResult<T>[]> {
  const client = databaseClient();
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'authenticated', ...claims }),
    ]);
    const results: pg.QueryResult<T>[] = [];
    for (const statement of statements) {
      results.push(await client.query<T>(statement.text, statement.params ?? []));
    }
    return results;
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}
