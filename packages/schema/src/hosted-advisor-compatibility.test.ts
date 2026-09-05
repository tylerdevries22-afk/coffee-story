import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20260905120000_hosted_advisor_compatibility.sql',
), 'utf8');

describe('hosted Supabase advisor compatibility', () => {
  it('runs the activity projection with the caller privileges', () => {
    assert.match(migration,
      /alter view public\.activity_board_items set \(security_invoker = true\)/);
  });

  it('stores portable assertion identities while retaining validated registration', () => {
    assert.match(migration,
      /alter column assertion type text using assertion::text/);
    assert.match(migration,
      /where proc\.oid = p_assertion and proc\.pronargs = 0/);
    assert.match(migration,
      /values \(p_release, p_note, p_assertion::text\)/);
  });

  it('registers a live-catalog assertion for both repairs', () => {
    assert.match(migration, /assert_hosted_advisor_compatibility/);
    assert.match(migration, /attribute\.atttypid = 'pg_catalog\.text'::regtype/);
    assert.match(migration, /security_invoker=true/);
    assert.match(migration, /to_regprocedure\(registered\.assertion\) is null/);
    assert.match(migration, /register_release\(\s*'20260905120000'/);
  });
});
