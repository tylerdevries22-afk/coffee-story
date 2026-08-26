import assert from 'node:assert/strict';
import test from 'node:test';

import { isConfigured as authIsConfigured } from './auth';
import { isConfigured as databaseIsConfigured } from './supabase-server';

test('the local wall ignores otherwise valid HQ live credentials', () => {
  const saved = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'publishable';
  process.env.COFFEE_STORY_DEMO_SYNC = '1';
  process.env.COFFEE_STORY_PREVIEW_WALL = '1';

  try {
    assert.equal(authIsConfigured(), false);
    assert.equal(databaseIsConfigured(), false);

    delete process.env.COFFEE_STORY_PREVIEW_WALL;
    assert.equal(authIsConfigured(), true);
    assert.equal(databaseIsConfigured(), true);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
