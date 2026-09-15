import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  migrationVersionAlignments,
  planPendingMigrations,
  type LocalMigration,
} from '../../../scripts/hosted-migrations.ts';

const shared = (version: string): LocalMigration => ({
  version,
  name: 'shared_name',
  query: 'select 1;',
});

describe('hosted migration duplicate-name reconciliation', () => {
  it('matches exact versions when intentional migrations share a stable name', () => {
    const migrations = [
      shared('20260828163000'),
      shared('20260828163001'),
      { ...shared('20260828163002'), name: 'unique_name' },
    ];
    const remote = migrations.slice(0, 2).map(({ name, version }) => ({ name, version }));
    assert.deepEqual(planPendingMigrations(migrations, remote), migrations.slice(2));
    assert.deepEqual(migrationVersionAlignments(migrations, remote), []);
  });

  it('rejects ambiguous clock drift across a shared name', () => {
    const migrations = [shared('20260828163000'), shared('20260828163001')];
    assert.throws(
      () => planPendingMigrations(migrations, [{ version: '20260828170000', name: 'shared_name' }]),
      /cannot be matched to one local version/,
    );
  });

  it('rejects a duplicate remote version and name identity', () => {
    const migrations = [shared('20260828163000'), shared('20260828163001')];
    assert.throws(
      () => planPendingMigrations(migrations, [
        { version: '20260828163000', name: 'shared_name' },
        { version: '20260828163000', name: 'shared_name' },
      ]),
      /identities must be unique/,
    );
  });
});
