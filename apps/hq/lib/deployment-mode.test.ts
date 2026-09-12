import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { demoFallbackAllowed, isConfigured } from './deployment-mode';

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'COFFEE_STORY_PREVIEW_WALL',
  'COFFEE_STORY_DEMO_SYNC',
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function env(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('demoFallbackAllowed', () => {
  /**
   * The fixture session is a platform_admin, so this predicate is the whole
   * distance between a misconfigured production deploy and a console served
   * to anyone who asks for it.
   */
  it('refuses the fixture fallback in production', () => {
    assert.equal(demoFallbackAllowed({ NODE_ENV: 'production' }), false);
  });

  it('allows it everywhere else, so local review is unchanged', () => {
    assert.equal(demoFallbackAllowed({ NODE_ENV: 'development' }), true);
    assert.equal(demoFallbackAllowed({ NODE_ENV: 'test' }), true);
    assert.equal(demoFallbackAllowed({}), true);
  });
});

describe('isConfigured', () => {
  it('needs both client variables', () => {
    env({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' });
    assert.equal(isConfigured(), true);
    env({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' });
    assert.equal(isConfigured(), false);
    env({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' });
    assert.equal(isConfigured(), false);
  });

  /**
   * Independent of demoFallbackAllowed on purpose. The service credentials
   * live in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, not the NEXT_PUBLIC_
   * pair, so "unconfigured" never meant "holds no credentials" -- which is why
   * the production rule cannot be left to whether the fixtures are harmless.
   */
  it('answers only about the client variables', () => {
    env({});
    assert.equal(isConfigured(), false);
    assert.equal(demoFallbackAllowed({ NODE_ENV: 'production' }), false);
  });

  /** The preview wall is already refused in production by demoSyncRuntimeEnabled. */
  it('reports unconfigured for a preview wall that has both variables', () => {
    env({
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      COFFEE_STORY_PREVIEW_WALL: '1',
      COFFEE_STORY_DEMO_SYNC: '1',
    });
    assert.equal(isConfigured(), process.env.NODE_ENV === 'production');
  });
});
