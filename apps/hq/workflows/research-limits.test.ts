import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { reasoningFor } from './research-limits';

const SKIP = new Set(['node_modules', 'dist', 'build']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP.has(name) || name.startsWith('.') ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('hosted web search', () => {
  it('is bounded at every call site, so a run cannot choose its own cost', () => {
    // A new caller that forgets the bound fails here rather than on the invoice.
    const roots = [
      join(process.cwd(), 'app'), join(process.cwd(), 'lib'), join(process.cwd(), 'workflows'),
      join(process.cwd(), '..', '..', 'packages'),
    ];
    let searches = 0;
    const unbounded = roots.flatMap(sourceFiles).filter((path) => {
      const text = readFileSync(path, 'utf8');
      const here = text.match(/type: 'web_search'/g)?.length ?? 0;
      searches += here;
      return here > (text.match(/max_tool_calls:/g)?.length ?? 0);
    });
    assert.ok(searches >= 3, 'found no web_search callers -- this test is no longer looking in the right place');
    assert.deepEqual(unbounded, [], 'every web_search request needs max_tool_calls beside it');
  });
});

describe('reasoningFor', () => {
  it('asks reasoning models for low effort, never minimal', () => {
    for (const model of ['gpt-5', 'gpt-5-mini', ' gpt-5-nano ', 'o4-mini', 'o3']) {
      assert.deepEqual(reasoningFor(model), { effort: 'low' }, model);
    }
  });

  it('sends nothing to a model that does not reason', () => {
    for (const model of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o']) {
      assert.equal(reasoningFor(model), undefined, model);
    }
  });
});
