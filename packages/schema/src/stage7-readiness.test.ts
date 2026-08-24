import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const migration = readFileSync(
  join(process.cwd(), '../../supabase/migrations/20260824070000_brand_settings_and_channel_revenue.sql'),
  'utf8',
);

describe('Stage 7 settings write', () => {
  it('is RLS-scoped, concurrency checked, and preserves unrelated config sections', () => {
    assert.match(migration, /security invoker/i);
    assert.match(migration, /brand_config_stale/);
    assert.match(migration, /coalesce\(brand_config -> 'tokens'/);
    assert.doesNotMatch(migration, /set brand_config = config/);
    assert.match(migration, /revoke execute[\s\S]+from anon, public/i);
  });
});

describe('Stage 7 channel revenue', () => {
  it('publishes every order channel and keeps the aggregate read-only', () => {
    for (const channel of ['app', 'web', 'kiosk', 'pos']) {
      assert.match(migration, new RegExp(`'${channel}', coalesce\\(sum`));
    }
    assert.match(migration, /as revenue_by_channel/);
    assert.match(migration, /revoke insert, update, delete on public\.location_daily_metrics/);
  });
});
