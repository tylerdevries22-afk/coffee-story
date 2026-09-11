import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';

import { enforceCoverageSummary } from './check-coverage.ts';

it('enforces a finite line threshold from an Istanbul summary', async (t) => {
  const path = join(tmpdir(), `coffee-story-coverage-${randomUUID()}.json`);
  t.after(() => unlink(path).catch(() => undefined));
  await writeFile(path, JSON.stringify({ total: { lines: { pct: 41.25 } } }));

  assert.equal(await enforceCoverageSummary(path, 40), 41.25);
  await assert.rejects(enforceCoverageSummary(path, 42), /below the required 42/);
  await assert.rejects(enforceCoverageSummary(path, Number.NaN), /between 0 and 100/);
});
