import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseIndustryBlueprint } from './blueprint';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const BASE = {
  schemaVersion: 1,
  key: 'coffee-shop',
  name: 'Coffee shop',
  templateVersion: 1,
  locale: 'en-US',
  supabaseRegion: 'us-west-1',
  vocabulary: { catalog: 'Catalog', folder: 'Category', offering: 'Menu item', resource: 'Recipe' },
};

function valid(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE, ...extra };
}

describe('parseIndustryBlueprint', () => {
  it('accepts a valid blueprint and defaults recommendedModules to empty', () => {
    const result = parseIndustryBlueprint(valid());
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.blueprint.key, 'coffee-shop');
    assert.deepEqual(result.blueprint.recommendedModules, []);
  });

  it('accepts a valid recommendedModules list', () => {
    const result = parseIndustryBlueprint(valid({
      recommendedModules: ['commerce-ordering', 'growth-loyalty'],
    }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.blueprint.recommendedModules, ['commerce-ordering', 'growth-loyalty']);
  });

  it('rejects non-object input without throwing', () => {
    assert.equal(parseIndustryBlueprint(null).kind, 'invalid');
    assert.equal(parseIndustryBlueprint('coffee-shop').kind, 'invalid');
    assert.equal(parseIndustryBlueprint([valid()]).kind, 'invalid');
  });

  it('ignores unknown extra fields such as $docs', () => {
    const result = parseIndustryBlueprint(valid({
      $docs: { recommendedModules: 'Documentation is not data.' },
      futureField: { anything: true },
    }));
    assert.equal(result.kind, 'ok');
  });

  it('collects every missing required field rather than stopping at the first', () => {
    const result = parseIndustryBlueprint({ schemaVersion: 0 });
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('schemaVersion')));
    assert.ok(result.issues.some((issue) => issue.includes('key')));
    assert.ok(result.issues.some((issue) => issue.includes('name')));
    assert.ok(result.issues.some((issue) => issue.includes('templateVersion')));
    assert.ok(result.issues.some((issue) => issue.includes('locale')));
    assert.ok(result.issues.some((issue) => issue.includes('supabaseRegion')));
    assert.ok(result.issues.some((issue) => issue.includes('vocabulary')));
  });

  it('requires the shared vocabulary labels and non-empty strings', () => {
    const missing = parseIndustryBlueprint(valid({
      vocabulary: { catalog: 'Catalog', folder: 'Group', offering: 'Offering' },
    }));
    assert.equal(missing.kind, 'invalid');
    const blank = parseIndustryBlueprint(valid({
      vocabulary: { ...BASE.vocabulary, resource: '' },
    }));
    assert.equal(blank.kind, 'invalid');
    const notAnObject = parseIndustryBlueprint(valid({ vocabulary: ['Catalog'] }));
    assert.equal(notAnObject.kind, 'invalid');
  });

  it('rejects malformed recommended module keys', () => {
    const result = parseIndustryBlueprint(valid({
      recommendedModules: ['Commerce-Ordering', 'commerce--ordering', 'commerce_ordering'],
    }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('Commerce-Ordering')));
    assert.ok(result.issues.some((issue) => issue.includes('commerce--ordering')));
    assert.ok(result.issues.some((issue) => issue.includes('commerce_ordering')));
  });

  it('rejects repeated recommended modules', () => {
    const result = parseIndustryBlueprint(valid({
      recommendedModules: ['growth-loyalty', 'growth-loyalty'],
    }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('must not repeat')));
  });

  it('rejects a recommendedModules value that is not a list of strings', () => {
    assert.equal(parseIndustryBlueprint(valid({ recommendedModules: 'all' })).kind, 'invalid');
    assert.equal(parseIndustryBlueprint(valid({ recommendedModules: ['ok-key', 7] })).kind, 'invalid');
  });

  describe('shipped industry blueprints', () => {
    const SHIPPED = ['_template', 'coffee-shop', 'construction'];
    for (const industry of SHIPPED) {
      it(`parses industries/${industry}/blueprint.json`, () => {
        const path = join(REPOSITORY_ROOT, 'industries', industry, 'blueprint.json');
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        const result = parseIndustryBlueprint(raw);
        assert.equal(result.kind, 'ok', result.kind === 'invalid' ? result.issues.join('; ') : '');
      });
    }

    it('construction recommends no commerce or growth modules', () => {
      const path = join(REPOSITORY_ROOT, 'industries', 'construction', 'blueprint.json');
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const result = parseIndustryBlueprint(raw);
      assert.equal(result.kind, 'ok');
      if (result.kind !== 'ok') return;
      assert.ok(result.blueprint.recommendedModules.length > 0);
      for (const key of result.blueprint.recommendedModules) {
        assert.ok(!key.startsWith('commerce-') && !key.startsWith('growth-'), key);
      }
    });
  });
});
