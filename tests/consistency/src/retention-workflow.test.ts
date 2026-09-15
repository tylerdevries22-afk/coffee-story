import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(process.cwd(), '..', '..', '.github', 'workflows', 'tenant-package-retention.yml'),
  'utf8',
);

describe('tenant package retention workflow', () => {
  it('runs preview cleanup only when a preview project is configured', () => {
    assert.match(workflow, /vars\.SUPABASE_PREVIEW_PROJECT_REF != ''/);
    assert.match(workflow, /\["production","preview"\]/);
    assert.match(workflow, /\["production"\]/);
  });

  it('always keeps production in the cleanup matrix', () => {
    const matrixLine = workflow.split('\n').find((line) => line.includes('target: ${{'));
    assert.ok(matrixLine?.includes('production'));
  });
});
