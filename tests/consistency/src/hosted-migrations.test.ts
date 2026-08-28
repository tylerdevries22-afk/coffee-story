import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  findBlockingAdvisors,
  loadLocalMigrations,
  migrationVersionAlignments,
  parseMigrationFilename,
  planPendingMigrations,
  runHostedMigrationPromotion,
  toStructuredError,
  type LocalMigration,
} from '../../../scripts/hosted-migrations.ts';

const local = (version: string): LocalMigration => ({ version, name: `migration_${version}`, query: 'select 1;' });

describe('hosted migration promotion', () => {
  it('parses conventional migration filenames and rejects ambiguous names', () => {
    assert.deepEqual(parseMigrationFilename('20260828163000_award_training_competencies.sql'), {
      version: '20260828163000',
      name: 'award_training_competencies',
    });
    assert.throws(() => parseMigrationFilename('migration.sql'), /Invalid migration filename/);
  });

  it('loads migrations in version order and rejects duplicate versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hosted-migrations-'));
    try {
      await writeFile(join(directory, '20260828163001_second.sql'), 'select 2;');
      await writeFile(join(directory, '20260828163000_first.sql'), 'select 1;');
      assert.deepEqual((await loadLocalMigrations(directory)).map(({ version }) => version), [
        '20260828163000',
        '20260828163001',
      ]);
      await writeFile(join(directory, '20260828163001_duplicate.sql'), 'select 3;');
      await assert.rejects(loadLocalMigrations(directory), /versions must be unique/);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('plans only a contiguous forward suffix', () => {
    const migrations = [local('20260828163000'), local('20260828163001'), local('20260828163002')];
    assert.deepEqual(planPendingMigrations(migrations, [{
      version: '20260828163000',
      name: 'migration_20260828163000',
    }]), migrations.slice(1));
    assert.throws(
      () => planPendingMigrations(migrations, [{
        version: '20260828163001',
        name: 'migration_20260828163001',
      }]),
      /skips migration/,
    );
    assert.throws(
      () => planPendingMigrations(migrations, [{ version: '19990101000000', name: 'foreign' }]),
      /absent locally/,
    );
  });

  it('matches applied migrations by stable name and identifies wall-clock version drift', () => {
    const migrations = [local('20260828163000')];
    const remote = [{ version: '20260828174500', name: 'migration_20260828163000' }];
    assert.deepEqual(planPendingMigrations(migrations, remote), []);
    assert.deepEqual(migrationVersionAlignments(migrations, remote), migrations);
  });

  it('treats warning and error advisors as blocking without blocking informational notices', () => {
    const notices = [
      { level: 'INFO', name: 'info', title: 'Information' },
      { level: 'WARN', name: 'warn', title: 'Warning' },
      { level: 'ERROR', name: 'error', title: 'Error' },
    ];
    assert.deepEqual(findBlockingAdvisors(notices).map(({ name }) => name), ['warn', 'error']);
  });

  it('applies a pending migration, retries once, checks advisors, and verifies readiness', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hosted-migrations-'));
    await writeFile(join(directory, '20260828163000_release.sql'), 'select 1;');
    const responses: Array<Response | Error> = [
      Response.json({ message: 'temporarily unavailable' }, { status: 429 }),
      Response.json([]),
      Response.json({}, { status: 201 }),
      Response.json([{ version: '20260828163000', name: 'release' }]),
      Response.json([{ version: '20260828163000', name: 'release' }]),
      Response.json([{ version: '20260828163000', name: 'release', statements: ['select 1;'] }], { status: 201 }),
      Response.json({ lints: [] }),
      Response.json({ lints: [] }),
      Response.json([{ readiness: '20260828163000' }], { status: 201 }),
    ];
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(String(input));
      assert.match(new Headers(init?.headers).get('Authorization') ?? '', /^Bearer /);
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('insert into supabase_migrations.schema_migrations')) {
        assert.equal(new Headers(init?.headers).get('Idempotency-Key'), '20260828163000');
        assert.match(body, /begin;/);
        assert.match(body, /20260828163000/);
        assert.match(body, /pg_advisory_xact_lock/);
        assert.ok(body.indexOf('insert into supabase_migrations.schema_migrations') < body.indexOf('select 1;'));
      }
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response);
      return response;
    };
    try {
      const summary = await runHostedMigrationPromotion({
        accessToken: 'test-token',
        fetchImpl,
        migrationsDirectory: directory,
        projectRef: 'abcdefghijklmnopqrst',
        retryDelayMs: 0,
      });
      assert.deepEqual(summary.appliedVersions, ['20260828163000']);
      assert.deepEqual(summary.alignedVersions, []);
      assert.equal(summary.readiness, 20260828163000);
      assert.equal(requests.filter((url) => url.endsWith('/database/migrations')).length, 4);
      assert.equal(responses.length, 0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('does not replay a migration when its committed response is lost', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hosted-migrations-'));
    await writeFile(join(directory, '20260828163000_release.sql'), 'select 1;');
    const applied = [{ version: '20260828163000', name: 'release' }];
    const responses: Array<Response | Error> = [
      Response.json([]),
      new Error('connection closed after commit'),
      Response.json(applied),
      Response.json(applied),
      Response.json(applied),
      Response.json([{ ...applied[0], statements: ['select 1;'] }], { status: 201 }),
      Response.json({ lints: [] }),
      Response.json({ lints: [] }),
      Response.json([{ readiness: '20260828163000' }], { status: 201 }),
    ];
    let migrationRequests = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('insert into supabase_migrations.schema_migrations')) migrationRequests += 1;
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response);
      return response;
    };
    try {
      const summary = await runHostedMigrationPromotion({
        accessToken: 'test-token',
        expectedReadiness: 20260828163000,
        fetchImpl,
        migrationsDirectory: directory,
        projectRef: 'abcdefghijklmnopqrst',
        retryDelayMs: 0,
      });
      assert.deepEqual(summary.appliedVersions, ['20260828163000']);
      assert.equal(migrationRequests, 1);
      assert.equal(responses.length, 0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('fails closed when a managed migration file changes after publication', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hosted-migrations-'));
    await writeFile(join(directory, '20260828163000_release.sql'), 'select 1;');
    const applied = [{ version: '20260828163000', name: 'release' }];
    const responses: Response[] = [
      Response.json(applied),
      Response.json(applied),
      Response.json([{ ...applied[0], statements: ['select 2;'] }], { status: 201 }),
    ];
    const fetchImpl: typeof fetch = async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    };
    try {
      await assert.rejects(runHostedMigrationPromotion({
        accessToken: 'test-token',
        expectedReadiness: 20260828163000,
        fetchImpl,
        migrationsDirectory: directory,
        projectRef: 'abcdefghijklmnopqrst',
        retryDelayMs: 0,
      }), /differs from the immutable repository source/);
      assert.equal(responses.length, 0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects post-baseline history without an immutable managed record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hosted-migrations-'));
    await writeFile(join(directory, '20260828163000_release.sql'), 'select 1;');
    const applied = [{ version: '20260828163000', name: 'release' }];
    const responses: Response[] = [Response.json(applied), Response.json(applied), Response.json([], { status: 201 })];
    const fetchImpl: typeof fetch = async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    };
    try {
      await assert.rejects(runHostedMigrationPromotion({
        accessToken: 'test-token',
        expectedReadiness: 20260828163000,
        fetchImpl,
        migrationsDirectory: directory,
        projectRef: 'abcdefghijklmnopqrst',
        retryDelayMs: 0,
      }), /newer than the trusted legacy boundary/);
      assert.equal(responses.length, 0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('returns structured errors without exposing a stack trace', () => {
    assert.deepEqual(toStructuredError(new Error('failure')), {
      code: 'hosted_migration_failed',
      message: 'failure',
    });
  });

  it('labels a failed readiness contract without exposing the provider response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hosted-migrations-'));
    await writeFile(join(directory, '20260828163000_release.sql'), 'select 1;');
    const applied = [{ version: '20260828163000', name: 'release' }];
    const responses: Response[] = [
      Response.json(applied),
      Response.json(applied),
      Response.json([{ ...applied[0], statements: ['select 1;'] }], { status: 201 }),
      Response.json({ lints: [] }),
      Response.json({ lints: [] }),
      Response.json({ message: 'sensitive database detail' }, { status: 400 }),
    ];
    const fetchImpl: typeof fetch = async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    };
    try {
      await assert.rejects(runHostedMigrationPromotion({
        accessToken: 'test-token',
        fetchImpl,
        migrationsDirectory: directory,
        projectRef: 'abcdefghijklmnopqrst',
        retryDelayMs: 0,
      }), (error: unknown) => {
        assert.deepEqual(toStructuredError(error), {
          code: 'release_readiness_query_failed',
          message: 'Supabase /database/query request failed with HTTP 400.',
        });
        return true;
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
