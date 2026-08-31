import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

function orderedSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

describe('brand directory view security', () => {
  it('ends with caller privileges enforced after the last view definition', () => {
    const sql = orderedSql();
    const definitions = [...sql.matchAll(
      /create\s+(?:or\s+replace\s+)?view\s+public\.brand_directory\b/gi,
    )];
    const invokerOptions = [...sql.matchAll(
      /alter\s+view\s+public\.brand_directory\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/gi,
    )];

    assert.ok(definitions.length > 0, 'brand_directory is not defined');
    assert.ok(invokerOptions.length > 0, 'brand_directory uses definer privileges');
    assert.ok(
      (invokerOptions.at(-1)?.index ?? -1) > (definitions.at(-1)?.index ?? -1),
      'brand_directory was redefined after its security-invoker option was set',
    );
  });
});
